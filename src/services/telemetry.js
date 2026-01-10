/**
 * SHM (Self-Hosted Metrics) Telemetry Integration
 * 
 * Provides anonymous usage tracking to count active instances.
 * No personal data is collected - just a heartbeat to track deployments.
 * 
 * Respects DO_NOT_TRACK environment variable.
 */

let telemetryController = null;

async function startTelemetry() {
    // Respect user privacy - check DO_NOT_TRACK
    if (process.env.DO_NOT_TRACK === '1' || process.env.DO_NOT_TRACK === 'true') {
        console.log('[Telemetry] Disabled (DO_NOT_TRACK is set)');
        return null;
    }

    // Check if telemetry is explicitly disabled
    if (process.env.SHM_ENABLED === '0' || process.env.SHM_ENABLED === 'false') {
        console.log('[Telemetry] Disabled (SHM_ENABLED=false)');
        return null;
    }

    try {
        // Dynamic import for ESM module
        const { SHMClient } = await import('@btouchard/shm-sdk');

        const telemetry = new SHMClient({
            serverUrl: process.env.SHM_SERVER_URL || 'https://metrics.upandclear.org',
            appName: 'SeerrCatalog',
            appVersion: require('../../package.json').version || '1.0.0',
            environment: process.env.NODE_ENV || 'production',
            enabled: true,
        });

        // No custom metrics - just the automatic system metrics (CPU, RAM, OS, etc.)
        // SHM will track unique instances and send periodic heartbeats

        telemetryController = telemetry.start();
        console.log('[Telemetry] Started - anonymous usage tracking enabled');
        console.log('[Telemetry] Set DO_NOT_TRACK=1 or SHM_ENABLED=false to disable');

        return telemetryController;
    } catch (error) {
        // Silently fail - telemetry should never break the app
        console.log('[Telemetry] Could not start:', error.message);
        return null;
    }
}

function stopTelemetry() {
    if (telemetryController) {
        telemetryController.abort();
        telemetryController = null;
        console.log('[Telemetry] Stopped');
    }
}

module.exports = {
    startTelemetry,
    stopTelemetry
};
