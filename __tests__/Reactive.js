var Reactive = require('../Reactive');
var assert = require('assert');

function obj(arr) {
  var obj = {};
  for (var ii = 0; ii < arr.length; ++ii) {
    obj[arr[ii]] = true;
  }
  return obj;
}

describe('Reactive', function () {

  var callHistory;
  Reactive.beforeRun = function(instance) {
    callHistory.push(instance.id);
    if (callHistory.length > 1000) {
      assert.fail(callHistory.length, 1000,
        'Too deep call history, might be infinite loop'
      );
    }
  };

  beforeEach(function() {
    callHistory = [];
  });

  var TenTimesFive = Reactive.create({
    inputs: {
      value: 10
    },
    resolve: function (input, output) {
      output({
        value: input.value * 5
      });
    }
  });

  var InputTimesFive = Reactive.create({
    inputs: {
      value: Reactive.REQUIRED
    },
    resolve: function (input, output) {
      output({
        value: input.value * 5
      });
    }
  });

  var Ten = Reactive.create({
    resolve: function(input, output) {
      output({
        value: 10
      });
    }
  });

  var Eleven = Reactive.create({
    resolve: function(input, output) {
      output({
        value: 11
      });
    }
  });

  var ATimesB = Reactive.create({
    inputs: {
      a: Reactive.REQUIRED,
      b: Reactive.REQUIRED,
    },
    resolve: function (input, output) {
      output({
        value: input.a * input.b
      });
    }
  });

  var ATimesBAuto = Reactive.create({
    inputs: {
      a: 5,
      b: 5,
    },
    resolve: function (input, output) {
      output({
        value: input.a * input.b
      });
    }
  });

  var PulseAdder = Reactive.create({
    inputs: {
      value: 1,
      add: Reactive.PULSE,
      reset: Reactive.PULSE
    },
    resolve: function(input, output) {
      this.total = this.total || 0;
      if (input.reset) {
        this.total = 0;
      }
      if (input.add) {
        this.total += input.value;
      }
      output({
        total: this.total
      });
    }
  });

  it('runs upon construction', function() {
    var instance = new TenTimesFive();
    assert(instance.isRunning());
    assert.equal(instance.outputs.value, 50);
    assert.deepEqual(callHistory, [instance.id]);
  });

  it('does not run upon construction when link required', function() {
    var instance = new InputTimesFive();
    assert(!instance.isRunning());
    assert.equal(instance.outputs.value, undefined);
    assert.deepEqual(callHistory, []);
  });

  it('runs when linked', function() {
    var instance = new InputTimesFive();
    var tenInstance = new Ten();
    Reactive.link(tenInstance, 'value', instance, 'value');
    assert(instance.isRunning());
    assert.equal(instance.outputs.value, 50);
    assert.deepEqual(callHistory, [tenInstance.id, instance.id]);
  });

  it('allows one to many links', function() {
    var instance = new ATimesB();
    var tenInstance = new Ten();
    Reactive.link(tenInstance, 'value', instance, 'a');
    assert(!instance.isRunning());
    Reactive.link(tenInstance, 'value', instance, 'b');
    assert(instance.isRunning());
    assert.equal(instance.outputs.value, 100);
    assert.deepEqual(callHistory, [tenInstance.id, instance.id]);
  });

  /**
   *              +---+
   *        +---->|   |
   *        |     | B |>--+
   *        | +-->|   |   |
   *        | |   +---+   |
   * +---+  | | +---------+
   * | A |>-+ | |
   * +---+  | +-----------+
   *        |   | +---+   |
   *        |   +>|   |   |
   *        |     | C |>--+
   *        +---->|   |
   *              +---+
   */
  it('will not run instances with required inputs in a cycle', function() {
    var a = new Ten();
    var b = new ATimesB();
    var c = new ATimesB();
    var d = new Ten();
    Reactive.link(a, 'value', b, 'a');
    Reactive.link(a, 'value', c, 'a');
    Reactive.link(d, 'value', b, 'b');
    Reactive.link(d, 'value', c, 'b');

    assert.deepEqual(callHistory, [a.id, d.id, b.id, c.id]);

    // hook the first
    callHistory = [];
    Reactive.link(b, 'value', c, 'b');
    assert.deepEqual(callHistory, [c.id]);

    // hook the second
    callHistory = [];
    Reactive.link(c, 'value', b, 'b');
    assert.deepEqual(callHistory, []);
    assert(!b.isRunning());
    assert(!c.isRunning());
  });

  /**
   *              +---+
   *        +---->|   |
   *        |     | B |>--+
   *        | +-->|   |   |
   *        | |   +---+   |
   * +---+  | | +---------+
   * | A |>-+ | |
   * +---+  | +-----------+
   *        |   | +---+   |
   *        |   +>|   |   |
   *        |     | C |>--+
   *        +---->|   |
   *              +---+
   */
  it('will not infinite loop in a cycle', function() {
    var a = new Ten();
    var b = new ATimesBAuto();
    var c = new ATimesBAuto();

    callHistory = [];
    Reactive.link(a, 'value', b, 'a');
    Reactive.link(a, 'value', c, 'a');

    assert.deepEqual(callHistory, [b.id, c.id]);
    assert.equal(b.outputs.value, 50);
    assert.equal(c.outputs.value, 50);

    // hook the first
    callHistory = [];
    Reactive.link(b, 'value', c, 'b');
    assert.deepEqual(callHistory, [c.id]);
    assert.equal(c.outputs.value, 500);

    // hook the second
    callHistory = [];
    Reactive.link(c, 'value', b, 'b');
    assert.deepEqual(callHistory, [b.id, c.id]);
    assert.equal(b.outputs.value, 5000);
    assert.equal(c.outputs.value, 50000);
  });

  it('stops running when a non-running instance is linked', function() {
    var instance1 = new TenTimesFive();
    var instance2 = new InputTimesFive();

    assert(instance1.isRunning());
    assert(!instance2.isRunning());

    Reactive.link(instance2, 'value', instance1, 'value');
    assert(!instance1.isRunning());
    assert.deepEqual(callHistory, [instance1.id]);
  });

  it('begins running after a non-running instance is unlinked', function() {
    var instance1 = new TenTimesFive();
    var instance2 = new InputTimesFive();

    assert(instance1.isRunning());
    assert(!instance2.isRunning());

    Reactive.link(instance2, 'value', instance1, 'value');
    assert(!instance1.isRunning());

    instance1.unlink('value');
    assert(instance1.isRunning());

    // is only called once since when moved back to "running" it doesn't
    // actually need to be re-run since it's value has not changed.
    assert.deepEqual(callHistory, [instance1.id]);
  });

  it('does not re-run an instance with multiple inputs due to one change', function() {
    var atimesb = new ATimesB();
    var inputTimesFive = new InputTimesFive();
    var ten = new Ten();

    Reactive.link(inputTimesFive, 'value', atimesb, 'a');
    Reactive.link(inputTimesFive, 'value', atimesb, 'b');
    var tenLink = Reactive.link(ten, 'value', inputTimesFive, 'value');
    assert(atimesb.isRunning());
    assert.equal(atimesb.outputs.value, 2500);
    assert.deepEqual(callHistory, [ten.id, inputTimesFive.id, atimesb.id]);

    // reset call history
    callHistory = [];

    var eleven = new Eleven();
    Reactive.link(eleven, 'value', inputTimesFive, 'value');
    assert(atimesb.isRunning());
    assert.equal(atimesb.outputs.value, 3025);
    assert.deepEqual(callHistory, [eleven.id, inputTimesFive.id, atimesb.id]);
  });

  /**
   * +---+   +---+        +---+
   * | A |+->| B |+------>| D |
   * +---+   +---+        +---+
   *           +            ^
   *           |            |
   *           |   +---+    |
   *           +-->| C |+---+
   *               +---+
   */
  it('has proper execution order for non-tree graphs', function() {
    var a = new Ten();
    var b = new InputTimesFive();
    var c = new InputTimesFive();
    var d = new ATimesB();

    Reactive.link(b, 'value', d, 'a');
    Reactive.link(c, 'value', d, 'b');
    Reactive.link(b, 'value', c, 'value');
    Reactive.link(a, 'value', b, 'value');

    assert.deepEqual(a.dependencies, {});
    assert.deepEqual(b.dependencies, obj([a.id]));
    assert.deepEqual(c.dependencies, obj([a.id, b.id]));
    assert.deepEqual(d.dependencies, obj([a.id, b.id, c.id]));

    assert.equal(d.outputs.value, 12500);
    assert.deepEqual(callHistory, [a.id, b.id, c.id, d.id]);
  });

  // TODO: only runs dependents who's values have changed
  it('only runs an instance when inputs have changed', function() {
    var a = new Ten();
    var b = new InputTimesFive();
    Reactive.link(a, 'value', b, 'value');
    assert.equal(b.outputs.value, 50);
    assert.deepEqual(callHistory, [a.id, b.id]);

    callHistory = [];
    var c = new Ten();
    Reactive.link(c, 'value', b, 'value');
    assert.equal(b.outputs.value, 50);
    assert.deepEqual(callHistory, [c.id]);
  });

  // Test "pulse"
  it('only executes from a pulse when set to do so', function() {

    var triggerPulsar;
    var Pulsar = Reactive.create({
      resolve: function(input, output) {
        // TODO: maybe this should be state, not resolve?
        triggerPulsar = function() {
          output({
            pulse: Reactive.PULSE
          });
        }
      }
    });

    var a = new Pulsar();
    var b = new PulseAdder();
    assert.deepEqual(callHistory, [a.id, b.id]);

    callHistory = [];
    Reactive.link(a, 'pulse', b, 'add');
    assert.deepEqual(callHistory, []);
    assert.equal(b.outputs.total, 0);

    triggerPulsar();
    assert.equal(b.outputs.total, 1);
    triggerPulsar();
    assert.equal(b.outputs.total, 2);
    triggerPulsar();
    assert.equal(b.outputs.total, 3);
    assert.deepEqual(callHistory, [b.id, b.id, b.id]);

    callHistory = [];
    var c = new Ten();
    Reactive.link(c, 'value', b, 'value');
    assert.equal(b.outputs.total, 3);
    assert.deepEqual(callHistory, [c.id, b.id]);

    callHistory = [];
    triggerPulsar();
    assert.equal(b.outputs.total, 13);
    assert.deepEqual(callHistory, [b.id]);

    callHistory = [];
    b.unlink('add');
    Reactive.link(a, 'pulse', b, 'reset');
    assert.equal(b.outputs.total, 13);
    assert.deepEqual(callHistory, []);

    triggerPulsar();
    assert.equal(b.outputs.total, 0);
    assert.deepEqual(callHistory, [b.id]);
  });

  // TODO: Test infinite loop graph cycle. A calls B on nextFrame which then calls A on nextFrame.

});
