$(function () {
  if (!private) {
    $(".private").hide();
  }
  setInterval(setClock, 500);

  if (typeof getLastCommit == "function") {
    getLastCommit();
  }
});
function setClock() {
  var time = new Date();
  time = time.toUTCString();
  $(".clock").text(time);
}

// source: https://stackoverflow.com/a/8212878/9990365
function millisecondsToStr(milliseconds) {
  // TIP: to find current time in milliseconds, use:
  // var  current_time_milliseconds = new Date().getTime();

  function numberEnding(number) {
    return number > 1 ? "s" : "";
  }

  var temp = Math.floor(milliseconds / 1000);
  var years = Math.floor(temp / 31536000);
  if (years) {
    return years + " year" + numberEnding(years);
  }
  //TODO: Months! Maybe weeks?
  var days = Math.floor((temp %= 31536000) / 86400);
  if (days) {
    return days + " day" + numberEnding(days);
  }
  var hours = Math.floor((temp %= 86400) / 3600);
  if (hours) {
    return hours + " hour" + numberEnding(hours);
  }
  var minutes = Math.floor((temp %= 3600) / 60);
  if (minutes) {
    return minutes + " minute" + numberEnding(minutes);
  }
  var seconds = temp % 60;
  if (seconds) {
    return seconds + " second" + numberEnding(seconds);
  }
  return "less than a second"; //'just now' //or other string you like;
}
function removeCP(sno) {
  if (!sno) return;
  if (confirm("Remove CP #" + sno.toString() + "?")) {
    var $form = $(
      '<form action="/cp/' +
        sno +
        '/remove" method="POST" style="display:none;"></form>'
    );
    $form.appendTo($("body")).submit();
  }
}
