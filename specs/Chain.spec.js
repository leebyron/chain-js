var Chain = require('../Chain');

describe('Chain', function () {

  var callHistory;
  Chain.beforeRun = function(instance) {
    callHistory.push(instance.id);
    if (callHistory.length > 1000) {
      throw new Error('Too deep call history, might be infinite loop');
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

  var DeferPulse = Chain.create({
    inputs: {
      pulse: Chain.PULSE
    },
    outputs: {
      pulse: Chain.PULSE
    },
    resolve: function() {
      if (this.inputs.pulse) {
        process.nextTick(function() {
          this.output({pulse: Chain.PULSE});
        }.bind(this));
      }
    }
  });

  it('runs upon construction', function() {
    var instance = new TenTimesFive();
    expect(instance.isRunning()).toBe(true);
    expect(instance.getOutputValue('value')).toBe(50);
    expect(callHistory).toEqual([instance.id]);
  });

  it('does not run upon construction when link required', function() {
    var instance = new InputTimesFive();
    expect(instance.isRunning()).toBe(false);
    expect(instance.getOutputValue('value')).toBe(undefined);
    expect(callHistory).toEqual([]);
  });

  it('runs when linked', function() {
    var instance = new InputTimesFive();
    expect(instance.isRunning()).toBe(false);
    instance.setInputValues({value: 10});
    expect(instance.isRunning()).toBe(true);
    expect(instance.getOutputValue('value')).toBe(50);
    expect(callHistory).toEqual([instance.id]);
  });

  it('stops running when unlinked', function() {
    var instance = new InputTimesFive();
    expect(instance.isRunning()).toBe(false);
    instance.setInputValues({value: 10});
    expect(instance.isRunning()).toBe(true);
    instance.unlink('value');
    expect(instance.isRunning()).toBe(false);
    instance.setInputValues({value: 10});
    expect(instance.isRunning()).toBe(true);
    instance.setInputValues({value: undefined});
    expect(instance.isRunning()).toBe(false);
  });

  it('allows one to many links', function() {
    var inputTimesFive = new InputTimesFive();
    var aTimesB = new ATimesB();
    inputTimesFive.setInputValues({value: 2});
    Chain.link(inputTimesFive, 'value', aTimesB, 'a');
    expect(aTimesB.isRunning()).toBe(false);
    Chain.link(inputTimesFive, 'value', aTimesB, 'b');
    expect(aTimesB.isRunning()).toBe(true);
    expect(aTimesB.getOutputValue('value')).toBe(100);
    expect(callHistory).toEqual([inputTimesFive.id, aTimesB.id]);
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

    expect(callHistory).toEqual([a.id, d.id, b.id, c.id]);

    // hook the first
    callHistory = [];
    Chain.link(b, 'value', c, 'b');
    expect(callHistory).toEqual([c.id]);

    // hook the second
    callHistory = [];
    Chain.link(c, 'value', b, 'b');
    expect(callHistory).toEqual([]);
    expect(b.isRunning()).toBe(false);
    expect(c.isRunning()).toBe(false);
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

    expect(callHistory).toEqual([b.id, c.id]);
    expect(b.getOutputValue('value')).toBe(50);
    expect(c.getOutputValue('value')).toBe(50);

    // hook the first
    callHistory = [];
    Chain.link(b, 'value', c, 'b');
    expect(callHistory).toEqual([c.id]);
    expect(c.getOutputValue('value')).toBe(500);

    // hook the second
    callHistory = [];
    Chain.link(c, 'value', b, 'b');
    expect(callHistory).toEqual([b.id, c.id]);
    expect(b.getOutputValue('value')).toBe(5000);
    expect(c.getOutputValue('value')).toBe(50000);
  });

  it('stops running when a non-running instance is linked', function() {
    var instance1 = new TenTimesFive();
    var instance2 = new InputTimesFive();

    expect(instance1.isRunning()).toBe(true);
    expect(instance2.isRunning()).toBe(false);

    Chain.link(instance2, 'value', instance1, 'value');
    expect(instance1.isRunning()).toBe(false);
    expect(callHistory).toEqual([instance1.id]);
  });

  it('begins running after a non-running instance is unlinked', function() {
    var instance1 = new TenTimesFive();
    var instance2 = new InputTimesFive();

    expect(instance1.isRunning()).toBe(true);
    expect(instance2.isRunning()).toBe(false);

    Chain.link(instance2, 'value', instance1, 'value');
    expect(instance1.isRunning()).toBe(false);

    instance1.unlink('value');
    expect(instance1.isRunning()).toBe(true);

    // is only called once since when moved back to "running" it doesn't
    // actually need to be re-run since it's value has not changed.
    expect(callHistory).toEqual([instance1.id]);
  });

  it('does not re-run an instance with multiple inputs due to one change', function() {
    var aTimesB = new ATimesB();
    var inputTimesFive = new InputTimesFive();
    Chain.link(inputTimesFive, 'value', aTimesB, 'a');
    Chain.link(inputTimesFive, 'value', aTimesB, 'b');

    inputTimesFive.setInputValues({value: 10});
    expect(aTimesB.isRunning()).toBe(true);
    expect(aTimesB.getOutputValue('value')).toBe(2500);
    expect(callHistory).toEqual([inputTimesFive.id, aTimesB.id]);

    // reset call history
    callHistory = [];

    inputTimesFive.setInputValues({value: 11});
    expect(aTimesB.isRunning()).toBe(true);
    expect(aTimesB.getOutputValue('value')).toBe(3025);
    expect(callHistory).toEqual([inputTimesFive.id, aTimesB.id]);
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

    expect(c.getOutputValue('value')).toBe(12500);
    expect(callHistory).toEqual([a.id, b.id, c.id]);
  });

  it('only runs an instance when inputs have changed', function() {
    var a = new Ten();
    var b = new InputTimesFive();
    Chain.link(a, 'value', b, 'value');
    expect(b.getOutputValue('value')).toBe(50);
    expect(callHistory).toEqual([a.id, b.id]);

    callHistory = [];
    var c = new Ten();
    Chain.link(c, 'value', b, 'value');
    expect(b.getOutputValue('value')).toBe(50);
    expect(callHistory).toEqual([c.id]);

    callHistory = [];
    b.setInputValues({value: 10});
    expect(b.getOutputValue('value')).toBe(50);
    expect(callHistory).toEqual([]);
  });

  it('only executes from a pulse when set to do so', function() {
    var a = new Pulsar();
    var b = new PulseAdder();
    expect(callHistory).toEqual([a.id, b.id]);

    callHistory = [];
    Chain.link(a, 'pulse', b, 'add');
    expect(callHistory).toEqual([]);
    expect(b.getOutputValue('total')).toBe(0);

    a.trigger();
    expect(b.getOutputValue('total')).toBe(1);
    a.trigger();
    expect(b.getOutputValue('total')).toBe(2);
    a.trigger();
    expect(b.getOutputValue('total')).toBe(3);
    expect(callHistory).toEqual([b.id, b.id, b.id]);

    callHistory = [];
    b.setInputValues({value: 10});
    expect(b.getOutputValue('total')).toBe(3);
    expect(callHistory).toEqual([b.id]);

    callHistory = [];
    a.trigger();
    expect(b.getOutputValue('total')).toBe(13);
    expect(callHistory).toEqual([b.id]);

    callHistory = [];
    b.unlink('add');
    Chain.link(a, 'pulse', b, 'reset');
    expect(b.getOutputValue('total')).toBe(13);
    expect(callHistory).toEqual([]);

    a.trigger();
    expect(b.getOutputValue('total')).toBe(0);
    expect(callHistory).toEqual([b.id]);
  });

  /**
   * Test infinite loop graph cycle.
   * A calls B on nextFrame which then calls A on nextFrame. Lather, rinse.
   *
   *      +---+
   *  +-->| A |-+
   *  |   +---+ |
   *  | +-------+
   *  | | +---+
   *  | +>| B |-+
   *  |   +---+ |
   *  +---------+
   */
  it('can loop forever in a cycle', function(done) {
    var a = new DeferPulse();
    var b = new DeferPulse();

    Chain.link(a, 'pulse', b, 'pulse');
    Chain.link(b, 'pulse', a, 'pulse');

    var runs = 0;
    b.beforeRun = function() {
      if (++runs === 3) {
        // stop recursion
        b.unlink('pulse');
        expect(callHistory).toEqual([a.id, b.id, a.id, b.id, a.id, b.id]);
        done();
      }
    };

    callHistory = [];
    a.setInputValues({pulse: true});
    expect(callHistory).toEqual([a.id]);
  });

});
