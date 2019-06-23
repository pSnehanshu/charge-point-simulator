const fs = require('fs');
const shortid = require('shortid');
const WebSocketClient = require('websocket').client;
const Session = require('./session');

const cpfileroot = './charge-points/';

class ChargePoint {
    constructor(cpfile = {}) {
        /* Structure of CallResult Handlers
            {
                <UniqueId>: [<cb>, ...],
                .
                .
                .
            }
        */
        this.callResultHandlers = {};

        /* Structure of CallHandlers
            {
                <Action>: <cb>,
                .
                .
                .
            }
        */
        this.callHandlers = {};

        this.uids = [];
        this.sessions = [];

        if (cpfile.serialno) {
            this.serialno = cpfile.serialno;

            if (Array.isArray(cpfile.uids)) {
                this.uids = shuffle(cpfile.uids);

                if (Array.isArray(cpfile.sessions)) {
                    cpfile.sessions.forEach(sess => {
                        if (this.uids.includes(sess.uid)) {
                            this.sessions.push(sess);
                        }
                    });
                }
            }

            // Temporarily Load the logs as well
            this.log = cpfile.log;
        }

        // An instance of Socket.io io()
        this._io = null;

        // Whether the cp has been accepted by the beackend. Can be set by sending BootNotification
        this.accepted = false;

        // The status of the cp. Available/Occupied
        this.status = 'Available';

        // Setting meter value (wh)
        this.meterValue = cpfile.meterValue || 0;

        // Start saving
        setInterval(() => this.save(), 30000);
    }

    get io() {
        if (!this._io) {
            throw new Error('Socket io instance not set yet');
        }
        return this._io;
    }
    set io(io) {
        this._io = io;

        // If temporary logs exists, set them
        this._io.cps_msglog = Array.isArray(this.log) ? this.log : [];

        // Setup
        io.on('connection', socket => {
            console.log(`Socket.io connection established`);
        });
    }

    save() {
        return new Promise((resolve, reject) => {
            this.io.emit('save', 'saving');
            var data = JSON.stringify({
                serialno: this.serialno,
                uids: this.uids,
                meterValue: this.meterValue,
                sessions: this.sessions.map(s => typeof s.savable == 'function' ? s.savable() : s),
                log: this.io.cps_msglog
            }, null, 2);

            // Write
            fs.writeFile(cpfileroot + this.serialno + '.json', data, (err) => {
                if (err) return reject(err);
                this.io.emit('save', 'saved');
                resolve();
            });
        });
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.io.cps_emit('message', 'Trying to connect...');

            var key = Buffer.from(process.env.KEY, 'hex').toString();
            var basicAuth = Buffer.from(`${this.serialno}:${key}`).toString('base64');
            var url = `${process.env.BACKENDURL}/${this.serialno}`

            this.client = new WebSocketClient();
            this.client.connect(url, 'ocpp1.5', null, {
                Authorization: `Basic ${basicAuth}`,
            });

            this.client.on('connectFailed', (error) => {
                this.io.cps_emit('err', 'Connection Error: ' + error.toString());
            });

            this.client.on('connect', connection => {
                this.io.cps_emit('success', `CP #${this.serialno} has successfuly connected to the backend`);

                this.connection = connection;

                connection.on('error', (error) => {
                    this.io.cps_emit('err', "Connection Error: " + error.toString());
                });
                connection.on('close', async () => {
                    this.io.cps_emit('message', 'Websocket Connection Closed');
                    await this.connect();
                    await this.boot();
                });
                connection.on('message', (message) => {
                    this.io.cps_emit('unimportant', '<< Received:' + message.utf8Data);

                    const msg = JSON.parse(message.utf8Data);
                    const type = msg[0];
                    const id = msg[1];

                    if (type == 2) { // CALL
                        const action = msg[2];
                        const fn = this.callHandlers[action];

                        // Check if handlers are registered for the call
                        if (typeof fn == 'function') {
                            fn(msg, this.callRespond(msg));
                        }
                    }
                    else {
                        // Check if callbacks are registered for the response
                        if (this.callResultHandlers[id]) {
                            if (!Array.isArray(this.callResultHandlers[id])) {
                                this.callResultHandlers[id] = [this.callResultHandlers[id]];
                            }
                            this.callResultHandlers[id].forEach(cb => typeof cb == 'function' && cb(msg));
                            // After all response handled, removed the CALL
                            delete this.callResultHandlers[id];
                        }
                    }
                });
                resolve();
            });
        });
    }

    send(action = 'Heartbeat', payload = {}) {
        return new Promise((resolve, reject) => {
            if (!this.connection) {
                return reject('Connection with the backend has not yet been established.\nPlease connect to the backend first.');
            }
            if (!this.accepted && action != 'BootNotification') {
                return reject('Charge-point has not yet been accepted by the backend.\nPlease send BootNotification first and then retry.');
            }
            const msgTypeId = 2;
            const uniqueId = 'msg_' + shortid.generate();
            const msg = JSON.stringify([msgTypeId, uniqueId, action, payload]);

            this.io.cps_emit('unimportant', '>> Sending:' + msg);

            this.connection.sendUTF(msg);
            this.registerCall(uniqueId, resolve);
        });
    }

    callRespond(msg) {
        const self = this;

        function respond() {
            this.success = function (payload) {
                if (!self.connection) {
                    return self.io.cps_emit('err', 'Connection with the backend has not yet been established.\nPlease connect to the backend first.');
                }

                var response = JSON.stringify([3, msg[1], payload]);
                self.io.cps_emit('unimportant', `>> Sending: ${response}`);
                self.connection.sendUTF(response);
            }

            this.error = function () {

            }
        }

        return new respond;
    }

    // Handle Calls
    on(action, cb) {
        // Finally add the callback
        this.callHandlers[action] = cb;
    }

    registerCall(id, cb) {
        // Create entry if new ID
        if (!this.callResultHandlers[id]) {
            this.callResultHandlers[id] = [];
        }
        // Check if it is array, if not make it one
        if (!Array.isArray(this.callResultHandlers[id])) {
            this.callResultHandlers[id] = [this.callResultHandlers[id]];
        }

        // Finally push the callback
        this.callResultHandlers[id].push(cb);
    }

    async boot() {
        try {
            var retry = 10000;
            this.io.cps_emit('message', 'Sending BootNotification...');

            var msg = await this.send('BootNotification', {
                chargePointModel: 'HOMEADVANCED',
                chargePointVendor: 'eNovates',
            });

            var payload = msg[2];
            var status = payload.status;

            if (status == 'Accepted') {
                this.accepted = true;
                this.io.cps_emit('success', 'Charge point has been accepted');
                this.startHeartbeat(payload.heartbeatInterval * 1000);
                this.setStatus('Available');
            }
            else if (status == 'Rejected') {
                this.accepted = false;
                this.io.cps_emit('err', `Charge-point has been rejected by the backend.\nRetying after ${retry / 1000}s...`);
                setTimeout(() => this.boot(), retry);
            }
        } catch (err) {
            this.io.cps_emit('err', err.message);
            this.io.cps_emit('message', 'Retrying to send BootNotification...');
            this.accepted = false;
            setTimeout(() => this.boot(), retry);
        };
    }

    /**
     * Send heartbeat and possibily continue sending afterwards
     * @param {Number} resendAfter Miliseconds after which resend another heartbeat request. -1 for no resend.
     */
    async startHeartbeat(resendAfter = -1) {
        try {
            this.io.cps_emit('message', 'Sending heartbeat...');
            var msg = await this.send('Heartbeat')
            this.io.cps_emit('success', 'Heartbeat response received');
            if (resendAfter >= 0) {
                setTimeout(() => this.startHeartbeat(resendAfter), resendAfter);
                this.io.cps_emit('message', `Next heartbeat after ${resendAfter / 1000} s`);
            }
        } catch (err) {
            this.io.cps_emit('err', err.message);
        }
    }

    setStatus(status, connectorId = 0) {
        return new Promise((resolve, reject) => {
            this.send('StatusNotification', {
                connectorId,
                errorCode: 'NoError',
                status,
            }).then(msg => {
                this.status = status;
                this.io.cps_emit('success', `CP status has been set to ${this.status}`)
                resolve();
            }).catch(err => reject(err));
        });
    }

    start() {
        this.io.cps_emit('message', 'Starting auto-charge....');

        if (this.uids.length <= 0) {
            let errMSg = 'No driver UIDs added to start charging';
            this.io.cps_emit('err', errMSg);
            throw new Error(errMSg);
        }
        var i = 0;
        this.charge(this.uids[i], this.onSessionEnd(i));
    }

    async charge(uid, onEnd, connectorId = 1) {
        if (this.uids.includes(uid)) {
            // If cp isn't available, don't start charging
            if (this.status != 'Available') {
                return this.io.cps_emit('err', `Can't charge as charge point status "${this.status}"`);
            }

            try {
                // set to preparing
                var msg = await this.setStatus('Available', connectorId);

                var msg = await this.send('Authorize', { idTag: uid });
                if (msg[2].idTagInfo.status != 'Accepted') {
                    this.io.cps_emit('err', `UID #${uid} wasn't accepted by backend. Skipping...`);
                    return onEnd();
                }

                // set to preparing
                var msg = await this.setStatus('Preparing', connectorId);

                var sess = new Session(uid);
                this.sessions.push(sess);
                // Set socket.io io()
                sess.io = this.io;

                var msg = await this.send('StartTransaction', {
                    connectorId,
                    idTag: sess.uid,
                    meterStart: this.meterValue,
                    timestamp: new Date,
                });

                // Set status to charging
                var msg = await this.setStatus('Charging', connectorId);

                // Setting transactionId
                sess.txId = msg[2].transactionId;
                // Start the charging
                sess.status = 'Accepted';
                sess.startCharging(onEnd);

            } catch (error) {
                this.io.cps_emit('err', error.message);
            }
        } else {
            let errMsg = `The UID ${uid} isn't assigned to this chargepoint. Can't initiate the session.`;
            this.io.cps_emit('err', errMsg);
            throw new Error(errMsg);
        }
    }

    // A helper function that helps to loop charging session one after another
    onSessionEnd(i) {
        return async (sess) => {
            i++;
            if (sess && sess.status == 'Accepted') {
                // First StopTransaction
                // and then start the next transaction
                this.io.cps_emit('message', `Trying to stop charging UID #${sess.uid}...`);

                // Updating meterValue
                this.meterValue += sess.energy * 1000;

                var msg = await this.send('StopTransaction', {
                    idTag: sess.uid,
                    meterStop: this.meterValue,
                    timestamp: new Date,
                    transactionId: sess.txId,
                });

                this.io.cps_emit('success', `UID #${sess.uid} has stopped charging`);

                // Set status to Available
                await this.setStatus('Available');

                // Carry on charging the next
                if (this.uids[i]) {
                    this.charge(this.uids[i], this.onSessionEnd(i));
                }
            }
            else {
                // Carry on charging the next
                if (this.uids[i]) {
                    this.charge(this.uids[i], this.onSessionEnd(i));
                }
            }
        }
    }
}

module.exports = function (serial) {
    return new Promise((resolve, reject) => {
        fs.readFile(cpfileroot + serial + '.json', function (err, data) {
            var cpfile = {};
            if (err) {
                // Error occured. Maybe file doesn't exists. That means, it's a new CP
                cpfile.serialno = serial;
            } else {
                cpfile = JSON.parse(data);
                cpfile.serialno = serial;
            }

            var cp = new ChargePoint(cpfile);
            return resolve(cp);
        });
    });
}


function shuffle(array) {
    var currentIndex = array.length, temporaryValue, randomIndex;

    // While there remain elements to shuffle...
    while (0 !== currentIndex) {

        // Pick a remaining element...
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;

        // And swap it with the current element.
        temporaryValue = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temporaryValue;
    }

    return array;
}
