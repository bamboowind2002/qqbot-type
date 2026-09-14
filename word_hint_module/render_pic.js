var page = require('webpage').create();
var system = require('system');

// console.log(system.args[1])
page.zoomFactor = 1.4
page.viewportSize = { width: 700, height: 1 }


var html_path = "./word_hint_module/" + system.args[1] + ".html";
var png_path = "./word_hint_module/" + system.args[1] + ".png";
page.open(html_path, function (status) {
    var bb = page.evaluate(function () {
        return document.getElementsByTagName('html')[0].getBoundingClientRect();
    });
    page.clipRect = {
        top: bb.top,
        left: bb.left,
        width: bb.width * page.zoomFactor,
        height: bb.height * page.zoomFactor
    };
    if (status === "success") {
        page.render(png_path);
    }
    console.log("Status: " + status);
    phantom.exit();
});

// ${system.args[1]}