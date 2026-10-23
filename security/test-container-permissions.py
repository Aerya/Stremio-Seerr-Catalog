"""Exercise only unique disposable containers/volumes, never a deployed stack."""
import json, subprocess, sys, time, uuid
image, project = sys.argv[1:]
backend = '/app' if project == 'seerr' else '/app/packages/backend'
dbfile = '/app/data/' + ('seerr-catalog.db' if project == 'seerr' else 'cache.sqlite')
prefix = 'permissions-test-' + uuid.uuid4().hex[:12]
volumes, containers = [], []
def docker(*args, check=True):
    return subprocess.run(['docker', *args], text=True, capture_output=True, check=check).stdout.strip()
def node(volume, script, user='0:0'):
    return docker('run','--rm','--network','none','--user',user,'-w',backend,'-v',volume+':/app/data','--entrypoint','node',image,'-e',script)
def metadata(volume):
    return node(volume, f"const fs=require('fs');console.log(JSON.stringify({json.dumps(['/app/data',dbfile])}.map(p=>{{const s=fs.statSync(p);return [s.uid,s.gid,s.mode]}})))")
try:
    assert docker('run','--rm','--network','none','--entrypoint','id',image,'-u') == '1000'
    for legacy in [False, True]:
        volume=prefix+('-legacy' if legacy else '-new');volumes.append(volume);docker('volume','create',volume)
        mount=['-v',volume+':/app/data']
        before=None
        if legacy:
            node(volume, f"const fs=require('fs'),DB=require('better-sqlite3');const d=new DB('{dbfile}');d.exec(\"CREATE TABLE compatibility_probe(value TEXT); INSERT INTO compatibility_probe VALUES ('preserve-me')\");d.close();fs.chownSync('/app/data',0,0);fs.chmodSync('/app/data',0o700);fs.chownSync('{dbfile}',0,0);fs.chmodSync('{dbfile}',0o600)")
            before=metadata(volume)
            if project == 'nexo':
                # The database is readable but its directory cannot create WAL files.
                # A failed open must preserve the DB, not unlink it or hide it in RAM.
                node(volume, f"const fs=require('fs');fs.chmodSync('/app/data',0o555);fs.chmodSync('{dbfile}',0o444)")
                script=f"const fs=require('fs');const before=fs.readFileSync('{dbfile}');const cache=require('./dist/src/utils/sqliteCache');let failed=false;try{{cache.init('{dbfile}')}}catch(e){{failed=true}}if(!failed||!fs.readFileSync('{dbfile}').equals(before))process.exit(1)"
                node(volume, script,'1000:1000')
                node(volume, f"const fs=require('fs');fs.chmodSync('/app/data',0o700);fs.chmodSync('{dbfile}',0o600)")
        container=volume;containers.append(container)
        user=['--user','0:0'] if legacy else []
        docker('run','-d','--name',container,'--network','none',*user,*mount,'-e','CONFIG_SECRET=temporary-permissions-test-secret',image)
        for attempt in range(60):
            result=subprocess.run(['docker','exec',container,'node','-e',"fetch('http://127.0.0.1:7000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],capture_output=True)
            if result.returncode == 0: break
            if docker('inspect','--format','{{.State.Running}}',container)!='true':
                raise RuntimeError(docker('logs',container))
            time.sleep(1)
        else: raise RuntimeError('Health check timeout: '+docker('logs',container))
        assert docker('exec',container,'id','-u') == ('0' if legacy else '1000')
        if project == 'nexo':
            docker('exec','-w',backend,container,'node','-e',"const c=require('./dist/src/utils/sqliteCache');c.init(null);c.set('permissions-test',{ok:true},0);c.close()")
        docker('stop',container)
        # Actual persistent database must exist (no silent in-memory fallback).
        assert node(volume,f"const DB=require('better-sqlite3');const d=new DB('{dbfile}',{{fileMustExist:true}});console.log(d.prepare('PRAGMA integrity_check').get().integrity_check);d.close()")=='ok'
        if legacy:
            assert before==metadata(volume),'Ownership or permissions changed'
            assert node(volume,f"const DB=require('better-sqlite3');const d=new DB('{dbfile}');console.log(d.prepare('SELECT value FROM compatibility_probe').get().value);d.close()")=='preserve-me'
        print(('legacy root compatibility' if legacy else 'fresh non-root volume')+': PASS',flush=True)
finally:
    for c in containers: docker('rm','-f',c,check=False)
    for v in volumes: docker('volume','rm',v,check=False)
