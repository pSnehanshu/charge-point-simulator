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
};
