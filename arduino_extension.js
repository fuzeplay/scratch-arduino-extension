/*
 *This program is free software: you can redistribute it and/or modify
 *it under the terms of the GNU General Public License as published by
 *the Free Software Foundation, either version 3 of the License, or
 *(at your option) any later version.
 *
 *This program is distributed in the hope that it will be useful,
 *but WITHOUT ANY WARRANTY; without even the implied warranty of
 *MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *GNU General Public License for more details.
 *
 *You should have received a copy of the GNU General Public License
 *along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

(function(ext) {

  var PIN_MODE = 0xF4,
    REPORT_DIGITAL = 0xD0,
    REPORT_ANALOG = 0xC0,
    DIGITAL_MESSAGE = 0x90,
    START_SYSEX = 0xF0,
    END_SYSEX = 0xF7,
    QUERY_FIRMWARE = 0x79,
    REPORT_VERSION = 0xF9,
    ANALOG_MESSAGE = 0xE0,
    ANALOG_MAPPING_QUERY = 0x69,
    ANALOG_MAPPING_RESPONSE = 0x6A,
    CAPABILITY_QUERY = 0x6B,
    CAPABILITY_RESPONSE = 0x6C;

  // Fuze SysEx Functionality
  var TONE_DATA = 0x5F,
      LED_STRIP = 0x7C;

  var INPUT = 0x00,
    OUTPUT = 0x01,
    ANALOG = 0x02,
    PWM = 0x03,
    SERVO = 0x04,
    SHIFT = 0x05,
    I2C = 0x06,
    TONE = 0x0A;

  var TOTAL_PIN_MODES = 11;

  var LOW = 0,
    HIGH = 1;

  //Zubi Flyer pins
  //These aren't the same numbers are on the Arduino code, but it needs to be these to work
  var TRIANGLE_BUTTON_PIN = 10,
    CIRCLE_BUTTON_PIN = 4,
    SQUARE_BUTTON_PIN = 8,
    BUTTON_ONE_PIN = 6,
    BUTTON_TWO_PIN = 5,
    BUTTON_THREE_PIN = 20,
    BUZZER_PIN =  3, //Digital 3 (Untested)
    LIGHT_SENSOR_PIN = 3; //Analog 3

  //LED Strip
  var ALL_LEDS = 0x7F; //This means you change all LEDs
  var CLEAR_LED = 0x7F; //This means clear the selected LEDs

  //Codes for colors
  var COLOR_RED = 0x00;
  var COLOR_GREEN = 0x01;
  var COLOR_BLUE = 0x02;
  var COLOR_PURPLE = 0x03;
  var COLOR_TURQUOISE = 0x04;
  var COLOR_WHITE = 0x05;
  var COLOR_PINK = 0x06;

  //Buzzer
  var TONE_TONE = 0,
    TONE_NO_TONE = 1;

  var MAX_DATA_BYTES = 4096;
  var MAX_PINS = 128;

  var parsingSysex = false,
    waitForData = 0,
    executeMultiByteCommand = 0,
    multiByteChannel = 0,
    sysexBytesRead = 0,
    storedInputData = new Uint8Array(MAX_DATA_BYTES);

  var digitalOutputData = new Uint8Array(16),
    digitalInputData = new Uint8Array(16),
    analogInputData = new Uint16Array(16);

  var analogChannel = new Uint8Array(MAX_PINS);
  var pinModes = [];
  for (var i = 0; i < TOTAL_PIN_MODES; i++) pinModes[i] = [];

  var majorVersion = 0,
    minorVersion = 0;

  var connected = false;
  var notifyConnection = false;
  var device = null;
  var inputData = null;

  // TEMPORARY WORKAROUND
  // Since _deviceRemoved is not used with Serial devices
  // ping device regularly to check connection
  var pinging = false;
  var pingCount = 0;
  var pinger = null;

  // var hwList = new HWList();
  //
  // function HWList() {
  //   this.devices = [];
  //
  //   this.add = function(dev, pin) {
  //     var device = this.search(dev);
  //     if (!device) {
  //       device = {name: dev, pin: pin, val: 0};
  //       this.devices.push(device);
  //     } else {
  //       device.pin = pin;
  //       device.val = 0;
  //     }
  //   };
  //
  //   this.search = function(dev) {
  //     for (var i=0; i<this.devices.length; i++) {
  //       if (this.devices[i].name === dev)
  //         return this.devices[i];
  //     }
  //     return null;
  //   };
  // }

  function init() {

    for (var i = 0; i < 16; i++) {
      var output = new Uint8Array([REPORT_DIGITAL | i, 0x01]);
      device.send(output.buffer);
    }

    queryCapabilities();

    // TEMPORARY WORKAROUND
    // Since _deviceRemoved is not used with Serial devices
    // ping device regularly to check connection
    pinger = setInterval(function() {
      if (pinging) {
        if (++pingCount > 6) {
          clearInterval(pinger);
          pinger = null;
          connected = false;
          if (device) device.close();
          device = null;
          return;
        }
      } else {
        if (!device) {
          clearInterval(pinger);
          pinger = null;
          return;
        }
        queryFirmware();
        pinging = true;
      }
    }, 100);
  }

  function hasCapability(pin, mode) {
    if (pinModes[mode].indexOf(pin) > -1)
      return true;
    else
      return false;
  }

  function queryFirmware() {
    var output = new Uint8Array([START_SYSEX, QUERY_FIRMWARE, END_SYSEX]);
    device.send(output.buffer);
  }

  function queryCapabilities() {
    console.log('Querying ' + device.id + ' capabilities');
    var msg = new Uint8Array([
        START_SYSEX, CAPABILITY_QUERY, END_SYSEX]);
    device.send(msg.buffer);
  }

  function queryAnalogMapping() {
    console.log('Querying ' + device.id + ' analog mapping');
    var msg = new Uint8Array([
        START_SYSEX, ANALOG_MAPPING_QUERY, END_SYSEX]);
    device.send(msg.buffer);
  }

  function setDigitalInputs(portNum, portData) {
    digitalInputData[portNum] = portData;
  }

  function setAnalogInput(pin, val) {
    analogInputData[pin] = val;
  }

  function setVersion(major, minor) {
    majorVersion = major;
    minorVersion = minor;
  }

  function processSysexMessage() {
    switch(storedInputData[0]) {
      case CAPABILITY_RESPONSE:
        for (var i = 1, pin = 0; pin < MAX_PINS; pin++) {
          while (storedInputData[i++] != 0x7F) {
            if (storedInputData[i-1] < TOTAL_PIN_MODES) {
              pinModes[storedInputData[i-1]].push(pin);
            } else {
              console.log('Ignoring pin mode ' + storedInputData[i-1] + ' for pin ' + pin);
            }
            i++; //Skip mode resolution
          }
          if (i == sysexBytesRead) break;
        }
        queryAnalogMapping();
        break;
      case ANALOG_MAPPING_RESPONSE:
        for (var pin = 0; pin < analogChannel.length; pin++)
          analogChannel[pin] = 127;
        for (var i = 1; i < sysexBytesRead; i++)
          analogChannel[i-1] = storedInputData[i];
        for (var pin = 0; pin < analogChannel.length; pin++) {
          if (analogChannel[pin] != 127) {
            var out = new Uint8Array([
                REPORT_ANALOG | analogChannel[pin], 0x01]);
            device.send(out.buffer);
          }
        }
        notifyConnection = true;
        setTimeout(function() {
          notifyConnection = false;
        }, 100);
        break;
      case QUERY_FIRMWARE:
        if (!connected) {
          clearInterval(poller);
          poller = null;
          clearTimeout(watchdog);
          watchdog = null;
          connected = true;
          setTimeout(init, 200);
        }
        pinging = false;
        pingCount = 0;
        break;
    }
  }

  function processInput(inputData) {
    for (var i=0; i < inputData.length; i++) {

      if (parsingSysex) {
        if (inputData[i] == END_SYSEX) {
          parsingSysex = false;
          processSysexMessage();
        } else {
          storedInputData[sysexBytesRead++] = inputData[i];
        }
      } else if (waitForData > 0 && inputData[i] < 0x80) {
        storedInputData[--waitForData] = inputData[i];
        if (executeMultiByteCommand !== 0 && waitForData === 0) {
          switch(executeMultiByteCommand) {
            case DIGITAL_MESSAGE:
              setDigitalInputs(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);
              break;
            case ANALOG_MESSAGE:
              setAnalogInput(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);
              break;
            case REPORT_VERSION:
              setVersion(storedInputData[1], storedInputData[0]);
              break;
          }
        }
      } else {
        if (inputData[i] < 0xF0) {
          command = inputData[i] & 0xF0;
          multiByteChannel = inputData[i] & 0x0F;
        } else {
          command = inputData[i];
        }
        switch(command) {
          case DIGITAL_MESSAGE:
          case ANALOG_MESSAGE:
          case REPORT_VERSION:
            waitForData = 2;
            executeMultiByteCommand = command;
            break;
          case START_SYSEX:
            parsingSysex = true;
            sysexBytesRead = 0;
            break;
        }
      }
    }
  }

  function pinMode(pin, mode) {
    var msg = new Uint8Array([PIN_MODE, pin, mode]);
    device.send(msg.buffer);
  }

  function analogRead(pin) {
    if (pin >= 0 && pin < pinModes[ANALOG].length) {
      return Math.round((analogInputData[pin] * 100) / 1023);
    } else {
      var valid = [];
      for (var i = 0; i < pinModes[ANALOG].length; i++)
        valid.push(i);
      console.log('ERROR: valid analog pins are ' + valid.join(', '));
      return;
    }
  }

  function digitalRead(pin) {
    if (!hasCapability(pin, INPUT)) {
      console.log('ERROR: valid input pins are ' + pinModes[INPUT].join(', '));
      return;
    }
    pinMode(pin, INPUT);
    //Values are flipped, so need to return the inverse
    return !((digitalInputData[pin >> 3] >> (pin & 0x07)) & 0x01);
  }

  function analogWrite(pin, val) {
    if (!hasCapability(pin, PWM)) {
      console.log('ERROR: valid PWM pins are ' + pinModes[PWM].join(', '));
      return;
    }
    if (val < 0) val = 0;
    else if (val > 100) val = 100;
    val = Math.round((val / 100) * 255);
    pinMode(pin, PWM);
    var msg = new Uint8Array([
        ANALOG_MESSAGE | (pin & 0x0F),
        val & 0x7F,
        val >> 7]);
    device.send(msg.buffer);
  }

  function digitalWrite(pin, val) {
    if (!hasCapability(pin, OUTPUT)) {
      console.log('ERROR: valid output pins are ' + pinModes[OUTPUT].join(', '));
      return;
    }
    var portNum = (pin >> 3) & 0x0F;
    if (val == LOW)
      digitalOutputData[portNum] &= ~(1 << (pin & 0x07));
    else
      digitalOutputData[portNum] |= (1 << (pin & 0x07));
    pinMode(pin, OUTPUT);
    var msg = new Uint8Array([
        DIGITAL_MESSAGE | portNum,
        digitalOutputData[portNum] & 0x7F,
        digitalOutputData[portNum] >> 0x07]);
    device.send(msg.buffer);
  }

  setLEDStripColor = function(pin, color) {

    //Convert color String to color code
    var colorCode;

    switch (color) {
      case 'red':
        colorCode = COLOR_RED;
      break;
      case 'green':
        colorCode = COLOR_GREEN;
      break;
      case 'blue':
        colorCode = COLOR_BLUE;
      break;
      case 'purple':
        colorCode = COLOR_PURPLE;
      break;
      case 'turquoise':
        colorCode = COLOR_TURQUOISE;
      break;
      case 'white':
        colorCode = COLOR_WHITE;
      break;
      case 'pink':
        colorCode = COLOR_PINK;
      break;
      case 0x7F:
        //Clear it
        colorCode = CLEAR_LED;
      break;
      default:
          //Clear it
          colorCode = CLEAR_LED;
    }

    console.log(color+" color code: "+colorCode);

    var msg = new Uint8Array([
        START_SYSEX,
        LED_STRIP,
        pin, //Can also be ALL_LEDS
        colorCode, //Can also be CLEAR_LED
        END_SYSEX]);
    device.send(msg.buffer);
  }


  function getButtonPin(btn) {
    switch (btn) {
      case 'triangle button':
        return TRIANGLE_BUTTON_PIN;
      break;
      case 'square button':
        return SQUARE_BUTTON_PIN;
      break;
      case 'circle button':
        return CIRCLE_BUTTON_PIN;
      break;
      case 'button 1':
        return BUTTON_ONE_PIN;
      break;
      case 'button 2':
        return BUTTON_TWO_PIN;
      break;
      case 'button 3':
        return BUTTON_THREE_PIN;
      break;
      default:
          return null;
    }
  }

  function tone(freq, duration) {
    console.log('Playing tone');
    var msg = new Uint8Array([
        START_SYSEX,
        TONE_DATA,
        TONE_TONE,
        BUZZER_PIN,
        freq & 0x7F,
        freq >> 7,
        duration & 0x7f,
        duration >> 7,
        END_SYSEX]);
    device.send(msg.buffer);
  }

  function noTone(pin) {
    var msg = new Uint8Array([
        START_SYSEX,
       	TONE_DATA,
        TONE_NO_TONE,
        BUZZER_PIN,
        END_SYSEX]);
    device.send(msg.buffer);
  }

  ext.whenConnected = function() {
    if (notifyConnection) return true;
    return false;
  };

  ext.tone = function(pin, freq, duration) {
    tone(pin, freq, duration);
  };

  ext.noTone = function(pin) {
    noTone(pin);
  };

  //LED Strip methods

  ext.setStripLEDColor = function(index, color) {
    console.log('Setting led '+index+' color to '+color);
    setLEDStripColor(index, color);
  };

  ext.setAllStripLEDsColor = function(color) {
    console.log('Setting all led colors to '+color);
    setLEDStripColor(ALL_LEDS, color);
  };

  ext.clearStripLED = function(index) {
    console.log('Clearing led '+index);
    setLEDStripColor(index, CLEAR_LED);
  };

  ext.clearAllStripLEDs = function() {
    console.log('Clearing all LEDS');
    setLEDStripColor(ALL_LEDS, CLEAR_LED);
  };

  //Light sensor methods

  ext.readInput = function(name) {
    return analogRead(LIGHT_SENSOR_PIN);
  };

  ext.whenInput = function(op, val) {
    if (op == '>')
      return analogRead(LIGHT_SENSOR_PIN) > val;
    else if (op == '<')
      return analogRead(LIGHT_SENSOR_PIN) < val;
    else if (op == '=')
      return analogRead(LIGHT_SENSOR_PIN) == val;
    else
      return false;
  };

  //Button methods

  ext.whenButton = function(btn, state) {
    var pin = getButtonPin(btn);
    if (!pin) return;
    if (state === 'pressed')
      return digitalRead(pin);
    else if (state === 'released')
      return !digitalRead(pin);
  };

  ext.isButtonPressed = function(btn) {
    var pin = getButtonPin(btn);
    if (!pin) return;
    return digitalRead(pin);
  };

  ext._getStatus = function() {
    if (!connected)
      return { status:1, msg:'Disconnected' };
    else
      return { status:2, msg:'Connected' };
  };

  ext._deviceRemoved = function(dev) {
    console.log('Device removed');
    // Not currently implemented with serial devices
  };

  var potentialDevices = [];
  ext._deviceConnected = function(dev) {
    potentialDevices.push(dev);
    if (!device)
      tryNextDevice();
  };

  var poller = null;
  var watchdog = null;
  function tryNextDevice() {
    device = potentialDevices.shift();
    if (!device) return;

    device.open({ stopBits: 0, bitRate: 57600, ctsFlowControl: 0 });
    console.log('Attempting connection with ' + device.id);
    device.set_receive_handler(function(data) {
      var inputData = new Uint8Array(data);
      processInput(inputData);
    });

    poller = setInterval(function() {
      queryFirmware();
    }, 1000);

    watchdog = setTimeout(function() {
      clearInterval(poller);
      poller = null;
      device.set_receive_handler(null);
      device.close();
      device = null;
      tryNextDevice();
    }, 5000);
  }

  ext._shutdown = function() {
    // TODO: Bring all pins down
    if (device) device.close();
    if (poller) clearInterval(poller);
    device = null;
  };

  // Check for GET param 'lang'
  var paramString = window.location.search.replace(/^\?|\/$/g, '');
  var vars = paramString.split("&");
  var lang = 'en';
  for (var i=0; i<vars.length; i++) {
    var pair = vars[i].split('=');
    if (pair.length > 1 && pair[0]=='lang')
      lang = pair[1];
  }

  var blocks = {
    en: [
      ['h', 'when device is connected', 'whenConnected'],
      ['-'],
      ['h', 'when %m.buttons is %m.btnStates', 'whenButton', 'triangle button', 'pressed'],
      ['b', '%m.buttons pressed?', 'isButtonPressed', 'triangle button'],
      ['-'],
      ['h', 'when light sensor %m.ops %n%', 'whenInput', '>', 50],
      ['r', 'read light sensor', 'readInput'],
      ['-'],
      [' ', 'set all leds to %m.ledColors', 'setAllStripLEDsColor', 'red'],
      [' ', 'set led %n to %m.ledColors', 'setStripLEDColor', 0, 'red'],
      [' ', 'clear all leds', 'clearAllStripLEDs'],
      [' ', 'clear led %n', 'clearStripLED', 0]
    ]
  };

  var menus = {
    en: {
      buttons: ['triangle button', 'square button', 'circle button', 'button 1', 'button 2', 'button 3'],
      btnStates: ['pressed', 'released'],
      outputs: ['on', 'off'],
      ops: ['>', '=', '<'],
      ledColors: ['red', 'green', 'blue', 'purple', 'turquoise', 'white', 'pink']
    }
  };

  var descriptor = {
    blocks: blocks[lang],
    menus: menus[lang],
    url: 'https://github.com/fuzeplay/scratch-arduino-extension'
  };

  ScratchExtensions.register('Zubi Flyer', descriptor, ext, {type:'serial'});

})({});
