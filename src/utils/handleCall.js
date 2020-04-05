module.exports = function (cp) {
    cp.on('Reset', function (msg, res) {
        var payload = msg[3];

        if (payload.type == 'Soft') {
            // Soft reset
        }
        else if (payload.type == 'Hard') {
            // Hard reset
        }
        else {
            // Send a CALLERROR
            return res.error();
        }

        // TODO: Remove this later on
        res.success({
            status: 'Rejected'
        });
    });

    cp.on('RemoteStopTransaction', function (msg, res) {
        var payload = msg[3];

        res.success({
            status: 'Rejected'
        });
    });

    cp.on('UnlockConnector', function (msg, res) {
        res.success({
            status: 'Rejected'
        });
    });

    cp.on('TriggerMessage', function (msg, res) {
        // Trigger message is only supported in OCPP 1.6 and above.
        if (cp.getParam('ocppVersion') != 'ocpp1.6') {
            return;
        }

        let status = 'NotImplemented';
        let { requestedMessage, connectorId } = msg[3];

        switch (requestedMessage) {
            case 'BootNotification':
                status = 'Accepted';
                cp.boot();
                break;
            case 'DiagnosticsStatusNotification': break;
            case 'FirmwareStatusNotification': break;
            case 'Heartbeat':
                status = 'Accepted';
                cp.send('Heartbeat');
                break;
            case 'MeterValues': break;
            case 'StatusNotification':
                status = 'Accepted';
                cp.setStatus(cp.status, connectorId);
                break;
            default:
        }

        res.success({ status });
    });

    cp.on('ChangeAvailability', function (msg, res) {
        var { type } = msg[3];
        var checkAndSetAvailability = async function (status = 'Available') {
            // Check if any session in progress
            let lastSession = cp.currentSession;

            if (!lastSession.savable) {
                // No existing session
                res.success({ status: 'Accepted' });
                await cp.setStatus(status);
            } else {
                // Set status after the current session is over
                if (Array.isArray(lastSession.afterEnd)) {
                    res.success({ status: 'Scheduled' });
                    lastSession.afterEnd.push(async function () {
                        await cp.setStatus(status);
                        cp.inLoop = false;
                    });
                } else {
                    res.success({ status: 'Rejected' });
                }
            }
        };

        if (type === 'Inoperative') {
            checkAndSetAvailability('Unavailable');
        } else if (type === 'Operative') {
            checkAndSetAvailability('Available');
        } else {
            res.success({ status: 'Rejected' });
        }
    });
};
