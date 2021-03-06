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

let deviceId;
let isConnected = false,
    isTimerRunning = false,
    isRecording = false,
    isMuted = false,
    isSpeakerConnected = false,
    isVibrating = false;
var chunkSize = 18;
let TOPIC_HEADER = 0x36;
const SERVICE_DATA_KEY = '0x07';
var flags = 0x00;

let masks = {
    timerPause:   0xFE,   
    timerStart:   0x01,
    record:       0x02,
    mute:         0x04,
    speaker:      0x08,
    vibration:    0x10,
    bluetooth:    0x20
};

//Functions

function asHexString(i) {
    console.log('asHexString');
  let hex = i.toString(16);
  return "0x" + ((hex.length === 1)? '0': '') + hex;
}

function parseAdvertisingData(buffer) {
    console.log('parseAdvertisingData');
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
    console.log('generateServiceDataFromAdvertising');
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

// Characteristic 1
//   header | Data Size | Function
//--------------------------------------
// '1' 0x31 |     0     | Start Timer
// '2' 0x32 |     0     | Stop Timer
// '3' 0x33 |     0     | Reset Timer to 0
// '4' 0x34 |     0     | Mute Audio
// '5' 0x35 |     0     | Unmute Audio

//      Characteristic 2
//   header |      Data Size      | Function
//--------------------------------------------------
// 'a' 0x61 |(1)->Size (18)->Title| Change Topic
// 'b' 0x62 |      (4)->Time      | Set Timer
// 'c' 0x63 |  (?)->Volume Level  | Volume Change

var uuids = {
    service: "dead1400-dead-c0de-dead-c0dedeadc0de",
    char1: "dead1401-dead-c0de-dead-c0dedeadc0de",
    char2: "dead1402-dead-c0de-dead-c0dedeadc0de",
    char3: "dead1403-dead-c0de-dead-c0dedeadc0de",
    char4: "dead1404-dead-c0de-dead-c0dedeadc0de",
    char5: "dead1405-dead-c0de-dead-c0dedeadc0de",
    char6: "dead1406-dead-c0de-dead-c0dedeadc0de"
};

var uuids_ios = {
    service: "DEAD1400-DEAD-C0DE-DEAD-C0DEDEADC0DE",
}

const headers = {
    //Characteristic 1
    START_TIMER: '1',   //0x31
    STOP_TIMER: '2',    //0x32
    RESET_TIMER: '3',   //0x33
    MUTE_AUDIO: '4',    //0x34
    UNMUTE_AUDIO: '5',  //0x35
    RECORDING_ON: '6',  //0x36
    RECORDING_OFF: '7', //0x37
    SPEAKER_ON: '8',    //0x38
    SPEAKER_OFF: '9',   //0x39
    VIBRATION_ON: ':',  //0x3A
    VIBRATION_OFF: ';', //0x3B

    //Characteristic 2
    SET_TOPIC: 'a',     //0x61
    SET_TIMER: 'b',     //0x62
    VOLUME_CHANGE: 'c', //0x63
};

// var db = null;

var app = {
    initialize: function() {
        this.bindEvents();
    },

    bindEvents: function() {
        document.addEventListener('deviceready', this.onDeviceReady, false);
        deviceList.addEventListener('touchstart', this.connect, false); // assume not scrolling
        scanbutton.addEventListener('touchstart', this.refreshDeviceList, false);

        recordingReading.addEventListener('touchstart', this.changeRecordStatus, false);
        muteReading.addEventListener('touchstart', this.changeMuteStatus, false);
        speakerReading.addEventListener('touchstart', this.changeSpeakerStatus, false);
        vibrationReading.addEventListener('touchstart', this.changeVibrationStatus, false);

        startTimerButton.addEventListener('touchstart', this.startTimer, false);
        pauseTimerButton.addEventListener('touchstart', this.pauseTimer, false);

        setTimerSubmitButton.addEventListener('touchstart', this.changeTimer, false);
        setTopicSubmitButton.addEventListener('touchstart', this.changeTopic, false);

        writeChar1Button.addEventListener('touchstart', this.changeCustomCharacteristic1, false);
        writeChar2Button.addEventListener('touchstart', this.changeCustomCharacteristic2, false);

        writeCustomButton.addEventListener('touchstart', this.writeCustomCommandField, false);
        disconnectButton.addEventListener('touchstart', this.disconnect, false);
    },

    onDeviceReady: function() { 
        console.log('device ready');       
        // app.refreshDeviceList();
    },

    refreshDeviceList: function() {
        console.log('scanbutton tapped');
        deviceList.innerHTML = "";  //Empties the list 
        //Scan for all devices
        if (device.platform == 'iOS') {
            console.log('ios device');
            ble.scan([uuids_ios.service], 5, app.onDiscoverDevice, app.onError);
        } else {
            console.log('android device');
            ble.scan([], 5, app.onDiscoverDevice, app.onError);
        }
    },

    onDiscoverDevice: function(dev) {
        console.log('onDiscoverDevice');
        scanbutton.innerHTML = 'RESCAN';
        deviceList.hidden = false;
        let uuid;
        let ind;
        if (device.platform =='Android') {
            uuid = generateServiceDataFromAdvertising(dev.advertising);
        } else {
            
            let temp;
            uuid = dev.advertising['kCBAdvDataServiceUUIDs'];
            console.log('uuid: ', uuid);
            for (var i = 0; i < uuid.length; i ++) {
                if (uuid[i] == uuids.service || uuid[i] == uuids_ios.service) {
                    temp = uuid[i];
                    ind = i;
                    break;
                }
            }
            uuid = temp;
        }
        if (uuid == uuids.service || uuid == uuids_ios.service) {
            console.log(JSON.stringify(dev));
            var listItem, html;
                
            if (device.platform == 'Android') {
                listItem = document.createElement('li');
                html = '<b>' + dev.name + '</b><br/>' +
                    'RSSI: ' + dev.rssi + '&nbsp;|&nbsp;' +
                    dev.id;
            } else {
                listItem = document.createElement('li');
                html = '<b>' + dev.advertising['kCBAdvDataLocalName'] + '</b><br/>' +
                    'RSSI: ' + dev.rssi + '&nbsp;|&nbsp;' +
                    dev.id;
            }
            listItem.dataset.deviceId = dev.id;  // TODO
            listItem.innerHTML = html;
            deviceList.appendChild(listItem);
        }
    },

    connect: function(e) {
        deviceId = e.target.dataset.deviceId;
        var onConnect = function(dev) {
            isConnected = true;
            app.writeCharacteristic1(0x00, function(data) { console.log('initialize characteristic 1'); }, app.onError);
            // ble.startNotification(deviceId, uuids.service, uuids.char1, function(buffer) {
            //     var data = Uint8Array(buffer);
            //     console.log('Data Changed: ', data);
            // }, app.onError);
            app.readCharacteristic1();
            app.readCharacteristic2();
            app.readCharacteristic3();
            app.readCharacteristic4();
            scanbutton.hidden = true;
            deviceList.innerHTML = "<h3 class='confirmation'>Connected To: " + dev.name + "</h3>";
            };
        ble.connect(deviceId, (dev) => onConnect(dev), app.onError);
    },

    changeRecordStatus: function() {
        console.log('Record Button Tapped');
        flags = flags ^ masks.record;
        app.writeCharacteristic1(flags, function(data) {
            console.log('Char 1 (RECORD): '+JSON.stringify(data));
            // isRecording = (flags & masks.record) != 0; 
        }, app.onError);
        app.readCharacteristic1();
    },

    changeMuteStatus: function() {
        console.log('Mute Button tapped');
        flags = flags ^ masks.mute;
        app.writeCharacteristic1(flags, function(data) {
            console.log('Char 1 (MUTE): '+JSON.stringify(data));
            // isMuted = (flags & masks.mute) != 0;
        }, app.onError);
        app.readCharacteristic1();
    },

    changeSpeakerStatus: function() {
        console.log('Speaker Button tapped');
        flags = flags ^ masks.speaker;
        app.writeCharacteristic1(flags, function(data) {
            console.log('Char 1 (SPEAKER): '+JSON.stringify(data));
            // isSpeakerConnected = (flags & masks.speaker) != 0;
        }, app.onError);
        app.readCharacteristic1();
    },

    changeVibrationStatus: function() {
        console.log('Vibration Button tapped');
        flags = flags ^ masks.vibration;
        app.writeCharacteristic1(flags, function(data) {
            console.log('Char 1 (VIBRATION): '+JSON.stringify(data));
            // isVibrating = (flags & masks.vibration) != 0;
        }, app.onError);
        app.readCharacteristic1();
    },

    changeTimer: function() {
        console.log('change timer tapped');
        let timerText = document.getElementById('timer-text').value;
        let val = headers.SET_TIMER + timerText;
        console.log('timerText: ', timerText);
        app.writeCharacteristic(val, function(data) {
            console.log('Char 3 (SET TIMER): '+JSON.stringify(data));
        }, app.onError, uuids.char3);
        app.readCharacteristic3();
    },

    changeTopic: function() {
        console.log('change topic tapped');
        let topicText = document.getElementById('topic-text').value;
        let val = headers.SET_TOPIC + topicText.length.toString() + topicText;
        console.log('topicText: ', topicText);
        app.writeCharacteristic(val, function(data) {
            console.log('Char 2 (SET TOPIC): '+JSON.stringify(data));
        }, app.onError, uuids.char2);
        app.readCharacteristic2();
    },

    changeVolume: function() {
        console.log('change volume tapped');

    },

    startTimer: function(event) {
        console.log("Start Pressed");
        flags = flags | masks.timerStart;
        app.writeCharacteristic1(flags, function(data) {
            console.log('Char 1 (START TIMER): '+JSON.stringify(data));
            // isTimerRunning = (flags & masks.timerCheck) != 0;
        }, app.onError); 
        app.readCharacteristic1();
    },

    pauseTimer: function(event) {
        console.log("Pause Pressed");
        flags = flags & masks.timerPause;
        app.writeCharacteristic1(flags, function(data) {
            console.log('Char 1 (PAUSE TIMER): '+JSON.stringify(data));
            // isTimerRunning = (flags & masks.timerCheck) != 0;
        }, app.onError);
        app.readCharacteristic1();
    },

    changeCustomCharacteristic1(e) {
        var val = document.getElementById('writeText1').value;
        console.log('val (Char 1): ', val);
        app.writeCharacteristic1(val, function(data) {
            console.log('Char 1 (CUSTOM COMMAND): '+JSON.stringify(data));
        }, app.onError);
    },

    changeCustomCharacteristic2(e) {
        var val = document.getElementById('writeText1').value;
        console.log('val (Char 2): ', val);
        app.writeCharacteristic(val, function(data) {
            console.log('Char 2 (CUSTOM COMMAND): '+JSON.stringify(data));
        }, app.onError, uuids.char2);
    },

    changeCustomCharacteristic3(e) {
        var val = document.getElementById('writeText1').value;
        console.log('val (Char 3): ', val);
        app.writeCharacteristic(val, function(data) {
            console.log('Char 3 (CUSTOM COMMAND): '+JSON.stringify(data));
        }, app.onError, uuids.char3);
    },

    changeCustomCharacteristic4(e) {
        var val = document.getElementById('writeText1').value;
        console.log('val (Char 4): ', val);
        app.writeCharacteristic(val, function(data) {
            console.log('Char 4 (CUSTOM COMMAND): '+JSON.stringify(data));
        }, app.onError, uuids.char4);
    },

    writeCharacteristic1: function(val, onSuccess, onError) {
        console.log("writeCharacteristic1");
        console.log("val: " + val);
        console.log("val type: " + typeof val);
        console.log(typeof val + " length: " + val.length);
        var data = new Uint8Array(1);
        data[0] = val;
        var vBuf = new Uint8Array(1);
        vBuf = data.buffer;
        console.log(vBuf);  //should be an array buffer by now

        ble.write(deviceId, uuids.service, uuids.char1, vBuf, onSuccess, onError);
    },

    writeCharacteristic: function(val, onSuccess, onError, characteristic) {
        console.log("writeCharacteristic");
        console.log("val: " + val);
        console.log("val type: " + typeof val);
        console.log(typeof val + " length: " + val.length);
        if (val.length <= 20) {
            var vBuf = new Uint8Array(20);
            vBuf = stringToBytes(val);

            console.log(vBuf);  //should be an array buffer by now

            ble.write(deviceId, uuids.service, characteristic, vBuf, onSuccess, onError);
        } else {
            alert('please limit to 18 characters');
        }
    },

    writeCustomCommandField: function(e) {
        // write custom value to characteristic 6
        var head = parseInt(document.getElementById('cus-head').value) & 0xFF;
        var val1 = parseInt(document.getElementById('cus1').value) & 0xFF;
        var val2 = parseInt(document.getElementById('cus2').value) & 0xFF;
        var val3 = parseInt(document.getElementById('cus3').value) & 0xFF;
        var val4 = parseInt(document.getElementById('cus4').value) & 0xFF;

        let val = new Uint8Array(5);
        console.log(typeof val1 + 'val1: ' + val1);
        console.log(typeof val2 + 'val2: ' + val2);
        console.log(typeof val3 + 'val3: ' + val3);
        console.log(typeof val4 + 'val4: ' + val4);

        
    },

    readCharacteristic1: function() {
        console.log("readCharacteristic1");
        ble.read(deviceId, uuids.service, uuids.char1, app.onReadCharacteristic1, app.onError);
    },

    readCharacteristic2: function() {
        console.log("readCharacteristic");
        ble.read(deviceId, uuids.service, uuids.char2, app.onReadCharacteristic2, app.onError);
    },

    readCharacteristic3: function() {
        console.log("readCharacteristic");
        ble.read(deviceId, uuids.service, uuids.char3, app.onReadCharacteristic3, app.onError);
    },

    readCharacteristic4: function() {
        console.log("readCharacteristic");
        ble.read(deviceId, uuids.service, uuids.char4, app.onReadCharacteristic4, app.onError);
    },

    onReadCharacteristic1: function(data) {
        console.log("Data: " + data);
        let i = 0;
        var val = String.fromCharCode.apply(null, new Uint8Array(data));
        var temp = val.charCodeAt(i);
        console.log(temp);
        console.log('Temp Type: ', typeof temp);
        console.log("Read " + temp + " as value of characteristic 1");

        app.updateFlags(temp);
    },

    onReadCharacteristic2: function(data) {
        console.log("Data: " + data);
        var val = String.fromCharCode.apply(null, new Uint8Array(data));
        console.log("Read " + val + " as value of characteristic 2");
        app.updateTopic(val);
    },

    onReadCharacteristic3: function(data) {
        console.log("Data: " + data);
        var val = String.fromCharCode.apply(null, new Uint8Array(data));
        console.log("Read " + val + " as value of characteristic 3");
        app.updateTimer(val);
    },

    onReadCharacteristic4: function(data) {
        console.log("Data: " + data);
        var val = String.fromCharCode.apply(null, new Uint8Array(data));
        console.log("Read " + val + " as value of characteristic 4");
    },

    updateFlags: function(byte) {
        var time = 'OFF',
            rec = 'OFF',
            mute = 'OFF',
            speak = 'OFF',
            vibe = 'OFF',
            conn = 'NOT CONNECTED';
        if ((byte & 0b00001) != 0) {
            time = 'ON';
        }
        if ((byte & 0b00010) != 0) {
            rec = 'ON';
        }
        if ((byte & 0b00100) != 0) {
            mute = 'ON';
        }
        if ((byte & 0b01000) != 0) {
            speak = 'ON';
        }
        if ((byte & 0b10000) != 0) {
            vibe = 'ON';
        }
        if (isConnected) {
            conn = 'CONNECTED';
        }
        recordingReading.innerHTML = 'Recording: ' + rec;  
        muteReading.innerHTML = 'Mute: ' + mute;
        speakerReading.innerHTML = 'Speaker: ' + speak;
        vibrationReading.innerHTML = 'Vibration: ' + vibe;  
        batteryReading.innerHTML = 'Battery: MID';
        bluetoothReading.innerHTML = 'Bluetooth: ' + conn;

    },

    updateTopic: function(val) {
        let start = 2;
        if(val.length > 11) {
            start = 3;
        }
        var temp = val.slice(start, val.length);
        topicReading.innerHTML = 'Topic: ' + temp;
    },

    updateTimer: function(val) {
        var temp = val.slice(1, val.length);
        timerReading.innerHTML = 'Timer: ' + temp;
    },

    updateVolume: function() {

    },

    disconnect: function(event) {
        isConnected = false;
        ble.disconnect(deviceId, app.showMainPage, app.onError);
    },

    showMainPage: function() {
        scanbutton.innerHTML = 'SCAN';
        scanbutton.hidden = false;
        deviceList.hidden = true;
    },

    onError: function(reason) {
        alert("ERROR: " + reason); // real apps should use notification.alert
    }
};