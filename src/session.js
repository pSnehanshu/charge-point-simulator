const shortid = require('shortid');
const { fork } = require('child_process');

class Session {
    constructor(uid, params = {}) {
        // Generate random session id
        this.id = shortid.generate();
        this.uid = uid;

        // Params
        this.energy = params.energy || 5;// in kWh (randomly between 5 to 60)
        this.power = params.power || 5.6; // in kW (randomly between 3.7 and 11)
        this.duration = this.energy * 60 / this.power; // in minutes
        this.start = params.start || new Date;
        this.stop = null;

        // The forked sub-process
        this.worker = null;
    }

    // Time elapsed in minutes
    get elapsed() {
        var now = new Date;
        var elapsed = this.start - now;
        return elapsed / 60000;
    }

    startCharging() {
        // Kill existsing worker if exists
        if (this.worker != null) {
            this.worker.kill();
            this.worker = null;
        }

        this.worker = fork('./sessionWorker.js');
        this.worker.send({ id: this.id, stopAfter: this.duration });
        this.worker.on('message', function (msg) {
            if (msg.stop) {
                this.stop = new Date;
            }
            if (msg.backendMsg) {
                console.log('> Msg from backend:', msg.backendMsg);
            }
        });
    }
};

module.exports = Session;
