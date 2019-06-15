const fs = require('fs');
const shortid = require('shortid');
const WebSocketClient = require('websocket').client;
const Session = require('./session');

const cpfileroot = './charge-points/';

class ChargePoint {
    constructor(cpfile = {}) {
        /* Structure of Call Register
            {
                <UniqueId>: [<cb>, ...],
                .
                .
                .
            }
        */
        this.callReg = {};

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
        }
    }

    save() {
        return new Promise((resolve, reject) => {
            var data = JSON.stringify({
                serialno: this.serialno,
                uids: this.uids,
                sessions: this.sessions,
            });

            // Write
            fs.writeFile(cpfileroot + this.serialno + '.json', data, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    }

    connect() {
        var key = Buffer.from(process.env.KEY, 'hex').toString();
        var basicAuth = Buffer.from(`${this.serialno}:${key}`).toString('base64');
        var url = `${process.env.BACKENDURL}/${this.serialno}`

        this.client = new WebSocketClient();
        this.client.connect(url, 'ocpp1.5', null, {
            Authorization: `Basic ${basicAuth}`,
        });

        this.client.on('connectFailed', function (error) {
            console.log('Connection Error: ' + error.toString());
        });

        this.client.on('connect', connection => {
            console.log(`CP #${this.serialno} has successfuly connected to the backend`);

            this.connection = connection;

            connection.on('error', function (error) {
                console.log("Connection Error: " + error.toString());
            });
            connection.on('close', function () {
                console.log('echo-protocol Connection Closed');
            });
            connection.on('message', (message) => {               
                const msg = JSON.parse(message.utf8Data);
                const type = msg[0];
                const id = msg[1];

                if (type == 2) { // CALL
                    // Handle CALL
                }
                else {
                    // Check if callbacks are registered for the response
                    if (this.callReg[id]) {
                        if (!Array.isArray(this.callReg[id])) {
                            this.callReg[id] = [this.callReg[id]];
                        }
                        this.callReg[id].forEach(cb => typeof cb == 'function' && cb(msg));
                    }
                }
            });
        });
    }

    send(action = 'Heartbeat', payload = {}) {
        return new Promise((resolve, reject) => {
            if (!this.connection) {
                return reject('Connection with the backend has not yet been established. Please wait...');
            }
            const msgTypeId = 2;
            const uniqueId = 'msg_' + shortid.generate();
            const msg = JSON.stringify([msgTypeId, uniqueId, action, payload]);
            
            console.log('Sending', msg);

            this.connection.sendUTF(msg);
            this.registerCall(uniqueId, resolve);
        });
    }

    registerCall(id, cb) {
        // Create entry if new ID
        if (!this.callReg[id]) {
            this.callReg[id] = [];
        }
        // Check if it is array, if not make it one
        if (!Array.isArray(this.callReg[id])) {
            this.callReg[id] = [this.callReg[id]];
        }

        // Finally push the callback
        this.callReg[id].push(cb);
    }

    start() {
        console.log('Starting charge....');

        if (this.uids.length <= 0) {
            throw new Error('No driver UIDs added to start charging');
        }
        var i = 0;
        this.charge(this.uids[i], this.onSessionEnd(i));
    }

    charge(uid, onEnd) {
        if (this.uids.includes(uid)) {
            var sess = new Session(uid);
            this.sessions.push(sess);
            // First StartTransaction
            // Then only start charging session
            this.send('StartTransaction', {
                
            }).then(msg => sess.startCharging(onEnd))
            .catch(err => console.error(err));

            return sess;
        } else {
            throw new Error(`The UID ${uid} isn't assigned to this chargepoint. Can't initiate the session.`);
        }
    }

    // A helper function that helps to loop charging session one after another
    onSessionEnd(i) {
        return (sess) => {
            // First StopTransaction
            // and then start the next transaction
            this.send('StopTransaction', {}).then(msg => {
                if (this.uids[++i]) {
                    this.charge(uids[i], this.onSessionEnd(i));
                }
            }).catch(err => console.error(err));
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
