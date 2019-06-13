const fs = require('fs');
const Session = require('./session');
const cpfileroot = './charge-points/';

class ChargePoint {
    constructor(cpfile = {}) {
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

    charge(uid) {
        if (this.uids.includes(uid)) {
            var sess = new Session(uid);
            this.sessions.push(sess);
            sess.startCharging();
            return sess;
        } else {
            throw new Error(`The UID ${uid} isn't assigned to this chargepoint. Can't initiate the session.`);
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
