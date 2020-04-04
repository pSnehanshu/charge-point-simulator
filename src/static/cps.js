var statusResetTimeout = null;
var leastSno = null;

// Load existing log messages
$(function () {
    setCurrentSession(currentSession);
    var myconsole = $('#console-inner');
    myconsole.append(
        $('<pre>').addClass('w3-text-white').text('Loading console...')
    );
    $.get(`/cp/${serialno}/msglog`, function (data) {
        myconsole.html('');
        data.forEach(msg => {
            if (leastSno == null) {
                leastSno = parseInt(msg.sno);
            }

            if (typeof msg.sno == 'number') {
                if (msg.sno < leastSno) {
                    leastSno = msg.sno;
                }
            }

            addMsg(msg.message, msg.type, msg.timestamp, false);
        });
        updateScroll('console');
    });
});

$('#console').scroll(function () {
    var myconsole = $('#console-inner');
    var pos = $(this).scrollTop();

    // Run when console is scrolled to top
    if (pos == 0) {
        var originalHeight = myconsole.height();
        // Find the least sno among the logs
        var before = leastSno;
        $.get(`/cp/${serialno}/msglog?before=${before}`, function (data) {
            data.reverse().forEach(msg => {
                if (leastSno == null) {
                    leastSno = parseInt(msg.sno);
                }

                if (typeof msg.sno == 'number') {
                    if (msg.sno < leastSno) {
                        leastSno = msg.sno;
                    }
                }
                var markup = addMsg(msg.message, msg.type, msg.timestamp, false, true);
                if (markup == null) {
                    return;
                }
                myconsole.prepend(markup);
            });

            // Scroll to previous place
            var extraHeight = myconsole.height() - originalHeight;
            myconsole.parent().scrollTop(extraHeight);
        });
    }
});

$('#act-heartbeat').click(function (e) {
    e.preventDefault();
    action(serialno, 'heartbeat');
});
$('#act-boot').click(function (e) {
    e.preventDefault();
    action(serialno, 'boot');
});
$('#act-startautocharge').click(function (e) {
    e.preventDefault();
    action(serialno, 'start');
});
$('#act-stopautocharge').click(function (e) {
    e.preventDefault();
    action(serialno, 'stop-loop');
});
$('#act-connect').click(function (e) {
    e.preventDefault();
    action(serialno, 'connect');
});
$('#act-disconnect').click(function (e) {
    e.preventDefault();
    action(serialno, 'disconnect');
});
$('#save').click(function (e) {
    e.preventDefault();
    action(serialno, 'save');
});
$('#clsbtn').click(function (e) {
    e.preventDefault();
    $('#console').html('');
    action(serialno, 'clear');
});
$('#stopCurrentSession').click(function (e) {
    e.preventDefault();
    if (confirm('Do you want to stop the current session?'))
        action(serialno, `stop/${currentSession.id}`, function (err, data) {
            if (err) return;
            if (data.found) {
                //setCurrentSession({});
            }
        });
});

// Socket.io /////////////////////////////////
const socket = io(`/${serialno}`);
socket.on('message', function (msg) {
    addMsg(msg, 'message');
});
socket.on('success', function (msg) {
    addMsg(msg, 'success');
});
socket.on('err', function (msg) {
    addMsg(msg, 'err');
});
socket.on('unimportant', function (msg) {
    addMsg(msg, 'unimportant');
});
socket.on('save', function (msg) {
    var btn = $('#save');
    if (msg == 'saving') {
        btn.text('Saving...').prop('disabled', true);
    } else {
        setTimeout(() => {
            btn.text('Saved').addClass('w3-green').prop('disabled', false);
            setTimeout(() => btn.text('Save').removeClass('w3-green'), 1000);
        }, 2000);
    }
});
socket.on('session', function (msg) {
    var session = JSON.parse(msg);
    setCurrentSession(session);
});
socket.on('heartbeat', function (resendAfter) {
    clearTimeout(statusResetTimeout);
    if (resendAfter < 0) {
        resendAfter = 90000;
    }
    // Set online
    $('#statusIndicator').removeClass('w3-red w3-orange').addClass('w3-green');
    $('#statusText').text('Online');
    statusResetTimeout = setTimeout(() => {
        $('#statusIndicator').addClass('w3-red').removeClass('w3-green w3-orange');
        $('#statusText').text('Offline');
    }, resendAfter);
});
////////////////////////////////////////////
function action(serial, act, cb) {
    $.post(`/cp/${serial}/${act}`, function (data, status) {
        if (typeof cb == 'function') cb(null, data, status);
        else console.log('Success!');
    }).fail(function () {
        if (typeof cb == 'function') cb('Failed to do the job');
        else alert('Failed to do the job');
    });
}

function updateScroll(id) {
    var element = document.getElementById(id);
    element.scrollTop = element.scrollHeight;
}
function addMsg(msg, type = 'message', timestamp, scrollDown = true, dontMount = false) {
    var myconsole = $('#console-inner');
    var pre = $('<pre>');
    var markup = null;

    // If no timestamp is set, then use the current time.
    if (!timestamp) timestamp = Date.now();

    var time = new Date(timestamp);
    msg = `[${time.toUTCString()}] ${msg}`;

    switch (type) {
        case 'message':
            markup = pre.addClass('w3-text-white').text(msg);
            break;
        case 'success':
            markup = pre.addClass('w3-text-green').text(msg);
            break;
        case 'unimportant':
            markup = pre.addClass('w3-text-grey').text(msg);
            break;
        case 'err':
            markup = pre.addClass('w3-text-red').text(msg);
            break;
    }

    if (dontMount) {
        return markup;
    }

    // If markup is still null, don't append it
    if (markup == null) {
        return markup;
    }

    // Mounting the markup
    myconsole.append(markup);

    if (scrollDown) {
        if ($('#autoscroll').is(':checked')) updateScroll('console');
    }
}
function setCurrentSession(session = {}) {
    if (session == null) session = {};

    currentSession = session;
    var currentUid = currentSession.uid || '--';
    var currentTxid = currentSession.txId || '--';
    var currentStartTime = (new Date(currentSession.start)).toUTCString() || '--';
    var currentDuration = Math.round(currentSession.duration) || '--';

    $('#currentUid').html(currentUid);
    $('#currentTxid').html(currentTxid);
    $('#currentStartTime').html(currentStartTime);
    $('#currentDuration').html(currentDuration + ' min');
}
