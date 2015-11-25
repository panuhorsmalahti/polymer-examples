var path = require('path');
var express = require('express');
var app = express();
var port = 3000;

app.use('/', express.static(__dirname));
app.use('/components', express.static(path.join(__dirname, "../bower_components")));
app.use('/components/pml', express.static(path.join(__dirname, "../")));

app.listen(port);
console.log("Listening http://127.0.0.1:" + port);
