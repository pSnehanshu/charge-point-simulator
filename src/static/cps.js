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
$('#act-connect').click(function (e) {
    e.preventDefault();
    action(serialno, 'connect');
});
$('#clsbtn').click(function (e) {
    e.preventDefault();
    $('#console').html('');
});

// Socket.io /////////////////////////////////
const socket = io(`/${serialno}`);
socket.on('message', function (msg) {
    $('#console').append(
        $('<pre>').text(msg)
    );
    if ($('#autoscroll').is(':checked')) updateScroll('console');
});

socket.on('err', function (msg) {
    $('#console').append(
        $('<pre>').addClass('w3-text-red').text(msg)
    );
    if ($('#autoscroll').is(':checked')) updateScroll('console');
});

////////////////////////////////////////////
function action(serial, act, cb) {
    $.post(`/cp/${serial}/${act}`, function(data, status) {
        if (typeof cb == 'function') cb(null, data, status);
        else console.log('Success!');
    }).fail(function () {
        if (typeof cb == 'function') cb('Failed to do the job');
        else alert('Failed to do the job');
    })
}

function updateScroll(id){
    var element = document.getElementById(id);
    element.scrollTop = element.scrollHeight;
}
