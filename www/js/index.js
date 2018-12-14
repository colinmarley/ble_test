// Copywright 2018 Colin Marley
//
//Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/* global mainPage, deviceList, refreshButton */
/* global detailPage, batteryState, batteryStateButton, disconnectButton */
/* global ble  */
/* jshint browser: true , devel: true*/
'use strict';

var chunkSize = 18;
let TOPIC_HEADER = 0x36;
const SERVICE_DATA_KEY = '0x07';

//Functions

function asHexString(i) {
  let hex = i.toString(16);
  return "0x" + ((hex.length === 1)? '0': '') + hex;
}

function parseAdvertisingData(buffer) {
  var length, type, data, i = 0, advertisementData = {};
  var bytes = new Uint8Array(buffer);

  // decode type constants from https://www.bluetooth.org/en-us/specification/assigned-numbers/generic-access-profile
  while (length !== 0) {
      length = bytes[i] & 0xFF;
      i++;
      type = bytes[i] & 0xFF;
      i++;
      data = bytes.slice(i, i + length - 1).buffer; // length includes type byte, but not length byte
      i += length - 2;  // move to end of data
      i++;

      advertisementData[asHexString(type)] = data;
  }
  return advertisementData;
}

const DASHES = ['','' ,'-','-','-','-','',''];

function generateServiceDataFromAdvertising(buffer) {
  let adData = parseAdvertisingData(buffer);
  let serviceData = adData[SERVICE_DATA_KEY];

  let uuid = "";

  if (serviceData) {
    let uuidBytes = new Uint16Array(serviceData);
    for (let i = uuidBytes.length - 1; i >= 0; --i) {
      uuid += DASHES[i] + uuidBytes[i].toString(16);
    }
  }
  return uuid;
}

function bytesToString(buffer) {
    return String.fromCharCode.apply(null, new Uint8Array(buffer));
}

function stringToBytes(string) {
    let arr = new Uint8Array(string.length);
    for (let i = 0; i < string.length; i++) {
        arr[i] = string.charCodeAt(i);
    }
    return arr.buffer;
}
/*
Parameters:
chunk - (int) The size of the second dimension of the 2d array to be returned
data - (array) The string to be chunked

Description:
- Creates a 2d array of the chunked strings to be used as data for the package(s)

Return:
-2d array [int][string]
*/
function chunkIt (chunk, data) {
    var temp = [],
        offset = 0;

    while (offset < (data.length + chunk)) {
        if ((offset + chunk) < data.length) {
            temp.push(data.slice(offset, (offset + chunk)));    //case where remaining data is greater than available slots
        } else {
            temp.push(data.slice(offset, data.length));  
        }                                                       //case where available slots is at least as big as amount of remaing data
    }
    return temp;
}
/*
Parameters:
header - (hex) The decriptor byte to tell the device which event it should prepare for
        (Topic-set: 0x35, Time-set: 0x36, Volume Change: 0x37)
num - (int) the number of packets to be sent in the series
data - (array[i][string]) The 2d string array of the characters to be passed in each packet.

Description: 
- Creates a 2D array of array buffers to send as packets to the device

Return:
- An array of array buffers to be sent as packages

*/
function packChar2 (header, num, data) {
    var pack = []* num;
    for (var i = 0; i < num; i++) {
        pack[i] = new Uint8Array(chunkSize);
        pack[i][0] = header.charCodeAt[0];
        if (data[i].length == chuckSize) {
            pack[i][1] = 0x01;
        } else {
            pack[i][1] = 0x00;
        }
        for (var j = 0; j < chunkSize; j++) {
            pack[i][j+2] = data.charCodeAt(j);
        }
    }
    return pack;
}

var uuids = {
    service: "dead1400-dead-c0de-dead-c0dedeadc0de",
    char1: "dead1401-dead-c0de-dead-c0dedeadc0de",
    char2: "dead1402-dead-c0de-dead-c0dedeadc0de"
};

// var db = null;

var app = {
    initialize: function() {
        this.bindEvents();
    },

    bindEvents: function() {
        document.addEventListener('deviceready', this.onDeviceReady, false);
        scanbutton.addEventListener('touchstart', this.refreshDeviceList, false);
        readChar1Button.addEventListener('touchstart', this.readCharacteristic1, false);
        writeChar1Button.addEventListener('touchstart', this.writeCharacteristic1, false);
        readChar2Button.addEventListener('touchstart', this.readCharacteristic2, false);
        writeChar2Button.addEventListener('touchstart', this.writeCharacteristic2, false);
        disconnectButton.addEventListener('touchstart', this.disconnect, false);
        deviceList.addEventListener('touchstart', this.connect, false); // assume not scrolling
        startTimerButton.addEventListener('touchstart', this.startTimer, false);
        pauseTimerButton.addEventListener('touchstart', this.pauseTimer, false);
        setTopicSubmitButton.addEventListener('touchstart', this.setTopic, false);
    },

    onDeviceReady: function() {        
        // app.refreshDeviceList();
    },

    refreshDeviceList: function() {
        deviceList.innerHTML = "";  //Empties the list 
        //Scan for all devices
        ble.scan([], 5, app.onDiscoverDevice, app.onError);
    },

    onDiscoverDevice: function(device) {
        scanbutton.innerHTML = 'RESCAN';
        deviceList.hidden = false;
        let uuid = generateServiceDataFromAdvertising(device.advertising);
        if (uuid == uuids.service) {
            console.log(JSON.stringify(device));
            var listItem = document.createElement('li'),
                html = '<b>' + device.name + '</b><br/>' +
                    'RSSI: ' + device.rssi + '&nbsp;|&nbsp;' +
                    device.id;

            listItem.dataset.deviceId = device.id;  // TODO
            listItem.innerHTML = html;
            deviceList.appendChild(listItem);
        }
    },

    connect: function(e) {
        var deviceId = e.target.dataset.deviceId,
            onConnect = function(device) {
                scanbutton.hidden = true;
                deviceList.innerHTML = "<h3 class='confirmation'>Connected To: " + device.name + "</h3>";
                readChar1Button.dataset.deviceId = deviceId;
                readChar2Button.dataset.deviceId = deviceId;
                writeChar1Button.dataset.deviceId = deviceId;
                writeChar2Button.dataset.deviceId = deviceId;
                disconnectButton.dataset.deviceId = deviceId;
                pauseTimerButton.dataset.deviceId = deviceId;
                startTimerButton.dataset.deviceId = deviceId;
                setTopicSubmitButton.dataset.deviceId = deviceId;
            };
        ble.connect(deviceId, (device) => onConnect(device), app.onError);
    },

    pauseTimer: function(event) {
        console.log("Pause Pressed");
        var deviceId = event.target.dataset.deviceId;
        var val = String(2);
        var vBuf = new Uint8Array(1);
        console.log ("val type: " + typeof val);
        console.log("val: " + val);
        vBuf = stringToBytes(val);

        ble.write(deviceId, uuids.service, uuids.char1, vBuf, console.log("Paused Timer: data = 0x32"), app.onError);
    },

    setTopic: function (event) {
        console.log("trying to setTopic");
        var deviceId = event.target.dataset.deviceId;
        var val = document.getElementById('topic-text').value;
        var len = val.length;
        if (len <= 20) {
            var vBuf = new Uint8Array(len);
            vBuf = stringToBytes(val);

            ble.write(deviceId, uuids.service, uuids.char2, vBuf, console.log("wrote '" + val + "' to characteristic 2"), app.onError);
        } else {
            alert("Please limit topic length to 20 characters or less");
        }
    },

    writeCharacteristic1: function(event) {
        console.log("writeCharacteristic1");
        var deviceId = event.target.dataset.deviceId;
        var val = document.getElementById("writeText1").value;
        console.log("val: " + val);
        console.log("val type: " + typeof val);
        console.log(typeof val + " length: " + val.length);
        if (val.length <= 1) {
            var vBuf = new Uint8Array(1);
            vBuf = stringToBytes(val);

            console.log(vBuf);  //should be an array buffer by now

            ble.write(deviceId, uuids.service, uuids.char1, vBuf, console.log("Wrote (" + val + ") to Characteristic1") , app.onError);
        } else {
            alert("Please limit to 1 Character");
        }
    },    

    startTimer: function(event) {
        console.log("Start Pressed");
        var deviceId = event.target.dataset.deviceId;
        var val = String(1);
        var vBuf = new Uint8Array(1);
        console.log ("val type: " + typeof val);
        console.log("val: " + val);
        vBuf = stringToBytes(val);

        ble.write(deviceId, uuids.service, uuids.char1, vBuf, console.log("Started Timer: data = 0x31"), app.onError);   
    },

    writeCharacteristic2: function(event) {
        console.log("writeCharacteristic2");
        var deviceId = event.target.dataset.deviceId;
        var val = document.getElementById("writeText2").value;
        console.log("val: " + val);
        console.log("val type: " + typeof val);
        console.log(typeof val + " length: " + val.length);
        var vBuf = new Uint8Array(1);
        vBuf = stringToBytes(val);

        console.log(vBuf);  //should be an array buffer by now

        ble.write(deviceId, uuids.service, uuids.char2, vBuf, console.log("Wrote (" + val + ") to Characteristic2") , app.onError);
    },

    readCharacteristic1: function(event) {
        console.log("readCharacteristic1");
        var deviceId = event.target.dataset.deviceId;
        ble.read(deviceId, uuids.service, uuids.char1, app.onReadCharacteristic1, app.onError);
    },

    readCharacteristic2: function(event) {
        console.log("readCharacteristic");
        var deviceId = event.target.dataset.deviceId;
        ble.read(deviceId, uuids.service, uuids.char2, app.onReadCharacteristic2, app.onError);
    },

    onReadCharacteristic1: function(data) {
        console.log("Data: " + data);
        var val = String.fromCharCode.apply(null, new Uint8Array(data));
        console.log("Read " + val + " as value of characteristic 1");

        document.getElementById("readText1").value = val;
    },

     onReadCharacteristic2: function(data) {
        console.log("Data: " + data);
        var val = String.fromCharCode.apply(null, new Uint8Array(data));
        console.log("Read " + val + " as value of characteristic 2");

        document.getElementById("readText2").value = val;
    },

    disconnect: function(event) {
        var deviceId = event.target.dataset.deviceId;
        ble.disconnect(deviceId, app.showMainPage, app.onError);
    },

    showMainPage: function() {
        scanbutton.innerHTML = 'SCAN';
        scanbutton.hidden = false;
        deviceList.hidden = true;
    },

    showDetailPage: function() {
        
    },

    onError: function(reason) {
        alert("ERROR: " + reason); // real apps should use notification.alert
    }
};