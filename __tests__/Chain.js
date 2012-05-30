var Chain = require('../Chain');
var assert = require('assert');

describe('Chain', function () {

  var callHistory;
  Chain.beforeRun = function(instance) {
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

  var TenTimesFive = Chain.create({
    inputs: {
      value: 10
    },
    resolve: function () {
      return this.inputs.value * 5;
    }
  });

  var InputTimesFive = Chain.create({
    inputs: {
      value: Chain.REQUIRED
    },
    resolve: function () {
      return this.inputs.value * 5;
    }
  });

  // Very simple output just for testing purposes.
  // You would typically never create an instance this simple.
  var Ten = Chain.create({
    resolve: function() {
      return 10;
    }
  });

  var ATimesB = Chain.create({
    inputs: {
      a: Chain.REQUIRED,
      b: Chain.REQUIRED
    },
    resolve: function () {
      return this.inputs.a * this.inputs.b;
    }
  });

  var ATimesBAuto = Chain.create({
    inputs: {
      a: 5,
      b: 5
    },
    resolve: function () {
      return this.inputs.a * this.inputs.b;
    }
  });

  var PulseAdder = Chain.create({
    inputs: {
      value: 1,
      add: Chain.PULSE,
      reset: Chain.PULSE
    },
    state: {
      total: 0
    },
    outputs: {
      total: 0
    },
    resolve: function() {
      if (this.inputs.reset) {
        this.state.total = 0;
      }
      if (this.inputs.add) {
        this.state.total += this.inputs.value;
      }
      // We can return state directly since it's identical to our
      // output definition.
      return {
        total: this.state.total
      };
    }
  });

  var Pulsar = Chain.create({
    outputs: {
      pulse: Chain.PULSE
    },
    resolve: function() {
      // TODO: remove this function
      // only things which have inputs will ever be resolved.
    },
    trigger: function() {
      this.output({
        pulse: Chain.PULSE
      });
    }
  });

  it('runs upon construction', function() {
    var instance = new TenTimesFive();
    assert(instance.isRunning());
    assert.equal(instance.getOutputValue('value'), 50);
    assert.deepEqual(callHistory, [instance.id]);
  });

  it('does not run upon construction when link required', function() {
    var instance = new InputTimesFive();
    assert(!instance.isRunning());
    assert.equal(instance.getOutputValue('value'), undefined);
    assert.deepEqual(callHistory, []);
  });

  it('runs when linked', function() {
    var instance = new InputTimesFive();
    assert(!instance.isRunning());
    instance.setInputValues({value: 10});
    assert(instance.isRunning());
    assert.equal(instance.getOutputValue('value'), 50);
    assert.deepEqual(callHistory, [instance.id]);
  });

  it('stops running when unlinked', function() {
    var instance = new InputTimesFive();
    assert(!instance.isRunning());
    instance.setInputValues({value: 10});
    assert(instance.isRunning());
    instance.unlink('value');
    assert(!instance.isRunning());
    instance.setInputValues({value: 10});
    assert(instance.isRunning());
    instance.setInputValues({value: undefined});
    assert(!instance.isRunning());
  });

  it('allows one to many links', function() {
    var inputTimesFive = new InputTimesFive();
    var aTimesB = new ATimesB();
    inputTimesFive.setInputValues({value: 2});
    Chain.link(inputTimesFive, 'value', aTimesB, 'a');
    assert(!aTimesB.isRunning());
    Chain.link(inputTimesFive, 'value', aTimesB, 'b');
    assert(aTimesB.isRunning());
    assert.equal(aTimesB.getOutputValue('value'), 100);
    assert.deepEqual(callHistory, [inputTimesFive.id, aTimesB.id]);
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
    Chain.link(a, 'value', b, 'a');
    Chain.link(a, 'value', c, 'a');
    Chain.link(d, 'value', b, 'b');
    Chain.link(d, 'value', c, 'b');

    assert.deepEqual(callHistory, [a.id, d.id, b.id, c.id]);

    // hook the first
    callHistory = [];
    Chain.link(b, 'value', c, 'b');
    assert.deepEqual(callHistory, [c.id]);

    // hook the second
    callHistory = [];
    Chain.link(c, 'value', b, 'b');
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
    Chain.link(a, 'value', b, 'a');
    Chain.link(a, 'value', c, 'a');

    assert.deepEqual(callHistory, [b.id, c.id]);
    assert.equal(b.getOutputValue('value'), 50);
    assert.equal(c.getOutputValue('value'), 50);

    // hook the first
    callHistory = [];
    Chain.link(b, 'value', c, 'b');
    assert.deepEqual(callHistory, [c.id]);
    assert.equal(c.getOutputValue('value'), 500);

    // hook the second
    callHistory = [];
    Chain.link(c, 'value', b, 'b');
    assert.deepEqual(callHistory, [b.id, c.id]);
    assert.equal(b.getOutputValue('value'), 5000);
    assert.equal(c.getOutputValue('value'), 50000);
  });

  it('stops running when a non-running instance is linked', function() {
    var instance1 = new TenTimesFive();
    var instance2 = new InputTimesFive();

    assert(instance1.isRunning());
    assert(!instance2.isRunning());

    Chain.link(instance2, 'value', instance1, 'value');
    assert(!instance1.isRunning());
    assert.deepEqual(callHistory, [instance1.id]);
  });

  it('begins running after a non-running instance is unlinked', function() {
    var instance1 = new TenTimesFive();
    var instance2 = new InputTimesFive();

    assert(instance1.isRunning());
    assert(!instance2.isRunning());

    Chain.link(instance2, 'value', instance1, 'value');
    assert(!instance1.isRunning());

    instance1.unlink('value');
    assert(instance1.isRunning());

    // is only called once since when moved back to "running" it doesn't
    // actually need to be re-run since it's value has not changed.
    assert.deepEqual(callHistory, [instance1.id]);
  });

  it('does not re-run an instance with multiple inputs due to one change', function() {
    var aTimesB = new ATimesB();
    var inputTimesFive = new InputTimesFive();
    Chain.link(inputTimesFive, 'value', aTimesB, 'a');
    Chain.link(inputTimesFive, 'value', aTimesB, 'b');

    inputTimesFive.setInputValues({value: 10});
    assert(aTimesB.isRunning());
    assert.equal(aTimesB.getOutputValue('value'), 2500);
    assert.deepEqual(callHistory, [inputTimesFive.id, aTimesB.id]);

    // reset call history
    callHistory = [];

    inputTimesFive.setInputValues({value: 11});
    assert(aTimesB.isRunning());
    assert.equal(aTimesB.getOutputValue('value'), 3025);
    assert.deepEqual(callHistory, [inputTimesFive.id, aTimesB.id]);
  });

  /**
   *      +---+        +---+
   * 10 ->| A |+------>| C |
   *      +---+        +---+
   *        +            ^
   *        |            |
   *        |   +---+    |
   *        +-->| B |+---+
   *            +---+
   */
  it('has proper execution order for non-tree graphs', function() {
    var a = new InputTimesFive();
    var b = new InputTimesFive();
    var c = new ATimesB();

    Chain.link(a, 'value', c, 'a');
    Chain.link(b, 'value', c, 'b');
    Chain.link(a, 'value', b, 'value');

    a.setInputValues({value: 10});

    assert.equal(c.getOutputValue('value'), 12500);
    assert.deepEqual(callHistory, [a.id, b.id, c.id]);
  });

  // TODO: only runs dependents who's values have changed
  it('only runs an instance when inputs have changed', function() {
    var a = new Ten();
    var b = new InputTimesFive();
    Chain.link(a, 'value', b, 'value');
    assert.equal(b.getOutputValue('value'), 50);
    assert.deepEqual(callHistory, [a.id, b.id]);

    callHistory = [];
    var c = new Ten();
    Chain.link(c, 'value', b, 'value');
    assert.equal(b.getOutputValue('value'), 50);
    assert.deepEqual(callHistory, [c.id]);

    callHistory = [];
    b.setInputValues({value: 10});
    assert.equal(b.getOutputValue('value'), 50);
    assert.deepEqual(callHistory, []);
  });

  // Test "pulse"
  it('only executes from a pulse when set to do so', function() {
    var a = new Pulsar();
    var b = new PulseAdder();
    assert.deepEqual(callHistory, [a.id, b.id]);

    callHistory = [];
    Chain.link(a, 'pulse', b, 'add');
    assert.deepEqual(callHistory, []);
    assert.equal(b.getOutputValue('total'), 0);

    a.trigger();
    assert.equal(b.getOutputValue('total'), 1);
    a.trigger();
    assert.equal(b.getOutputValue('total'), 2);
    a.trigger();
    assert.equal(b.getOutputValue('total'), 3);
    assert.deepEqual(callHistory, [b.id, b.id, b.id]);

    callHistory = [];
    b.setInputValues({value: 10});
    assert.equal(b.getOutputValue('total'), 3);
    assert.deepEqual(callHistory, [b.id]);

    callHistory = [];
    a.trigger();
    assert.equal(b.getOutputValue('total'), 13);
    assert.deepEqual(callHistory, [b.id]);

    callHistory = [];
    b.unlink('add');
    Chain.link(a, 'pulse', b, 'reset');
    assert.equal(b.getOutputValue('total'), 13);
    assert.deepEqual(callHistory, []);

    a.trigger();
    assert.equal(b.getOutputValue('total'), 0);
    assert.deepEqual(callHistory, [b.id]);
  });

  // TODO: Test infinite loop graph cycle. A calls B on nextFrame which then calls A on nextFrame.

});
