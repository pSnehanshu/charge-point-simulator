const shortid = require('shortid');
const { fork } = require('child_process');
const path = require('path');
const random = require('../utils/random');

const workerScript = path.join(__dirname, '../', 'sessionWorker.js');

class Session {
    constructor(uid, params = {}) {
        // Generate random session id
        this.id = 'sess_' + shortid.generate();
        this.uid = uid;

        // Params
        this.energy = params.energy || random(5, 60);// in kWh (randomly between 5 to 60)
        this.power = params.power || random(3.7, 11); // in kW (randomly between 3.7 and 11)
        this.start = params.start || new Date;
        this.stop = null;

        // The forked sub-process
        this.worker = null;

        // Transaction ID to be supplied by Backend
        this.txId = null;
        // Every session is invalid unless accepted
        this.status = 'Invalid';

        // An instance of Socket.io io()
        this._io = null;
    }

    get duration() {
        return this.energy * 60 / this.power; // in minutes
    }

    get enerySpent() {
        var duration = this.duration;
        var energy = this.energy;
        var elapsed = this.elapsed;

        if (elapsed >= duration) {
            return energy;
        }

        return (energy / duration) * elapsed;
    }

    get io() {
        if (!this._io) {
            throw new Error('Socket io instance not set yet');
        }
        return this._io;
    }
    set io(io) {
        this._io = io;

        // Setup
        io.on('connection', socket => {
            console.log(`Socket.io connection established`);
        });
    }

    // Time elapsed in minutes
    get elapsed() {
        var now = new Date;
        var elapsed = now - this.start;
        return Math.floor(elapsed / 60000);
    }

    startCharging(onEnd) {
        // Registering the callback
        this.onSessionEnd = onEnd;

        // Displaying session details in client
        this.io.cps_emit('message', JSON.stringify(this.savable(), null, 2));

        // Kill existsing worker if exists
        if (this.worker != null) {
            this.worker.kill();
            this.worker = null;
        }

        this.io.cps_emit('success', `Charging UID #${this.uid}`);
        this.worker = fork(workerScript);
        this.worker.send({ id: this.id, stopAfter: this.duration });
        this.worker.on('message', (msg) => {
            if (msg.message) {
                this.io.cps_emit('message', msg.message);
            }
            if (msg.stop) {
                this.stop = new Date;
                if (typeof this.onSessionEnd == 'function') {
                    this.onSessionEnd(this);
                }
            }
        });
    }

    // It will kill the worker and call the startCharging's callback
    stopCharging() {
        // If a session is already finished, don't try to stop it
        if (this.stop instanceof Date) {
            throw new Error(`Session ${this.id} has already stopped on ${this.stop.toLocaleString()}. Can't stop it again.`);
        } else {
            this.worker.kill();
            this.stop = new Date;
            if (typeof this.onSessionEnd == 'function') {
                this.onSessionEnd(this);
            }
        }
    }

    // returns a savable version of the session
    savable() {
        return {
            txId: this.txId,
            energy: this.energy,
            power: this.power,
            start: this.start,
            uid: this.uid,
            elapsed: this.elapsed,
            duration: this.duration,
            id: this.id,
        };
    }
};

module.exports = Session;
