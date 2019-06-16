$('#act-heartbeat').click(function (e) {
    e.preventDefault();
    $.post(`/cp/${serialno}/heartbeat`, function(data, status) {
        //alert('Success');
    });
});
$('#act-startautocharge').click(function (e) {
    e.preventDefault();
    $.post(`/cp/${serialno}/start`, function(data, status) {
        //alert('Success');
    });
});
$('#act-connect').click(function (e) {
    e.preventDefault();
    $.post(`/cp/${serialno}/connect`, function(data, status) {
        //alert('Success');
    });
});
$('#clsbtn').click(function (e) {
    e.preventDefault();
    $('#console').html('');
});

// Socket.io
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

function updateScroll(id){
    var element = document.getElementById(id);
    element.scrollTop = element.scrollHeight;
}
