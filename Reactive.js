'use strict';

var Reactive = {
  REQUIRED: '__REQUIRED__',
  PULSE: '__PULSE__'
};

Reactive.create = function(bag) {
  var fn = bag.resolve;
  var inputDefinition = bag.inputs || {};
  var inputDefaults = {};
  var stateDefaults = bag.state || {};
  var stateIsFn = bag.state instanceof Function;

  var pulseKeys = [];
  var numRequiredInputs = 0;

  for (var key in inputDefinition) {
    var value = inputDefinition[key];
    if (value === Reactive.PULSE) {
      inputDefaults[key] = false;
      pulseKeys.push(key);
    } else if (value === Reactive.REQUIRED) {
      inputDefaults[key] = undefined;
      numRequiredInputs++;
    } else {
      inputDefaults[key] = value;
    }
  }

  function ReactiveInstance() {
    this.id = totalInstances++;
    // TODO: better object copy
    this.inputs = JSON.parse(JSON.stringify(inputDefaults));
    if (stateIsFn) {
      this.state = stateDefaults.apply(this, arguments);
    } else {
      this.state = JSON.parse(JSON.stringify(stateDefaults));
    }
    Object.seal && Object.seal(this.state);

    // protected
    this._isValid = true;
    this._outputValues = {};
    this._outputLinks = {};
    this._inputLinks = {};
    this._dependencies = {};
    this._numUnlinkedRequiredInputs = numRequiredInputs;

    Object.seal && Object.seal(this);

    this._invalidate();
  }

  ReactiveInstance.prototype.output = function(values) {
    for (var key in values) {
      var value = values[key];
      // TODO: should have an output definition which makes pulse easier
      // to handle.
      var is_pulse = value === Reactive.PULSE;
      if (is_pulse) {
        // A pulse distributes a temporary "true" but is always represented as a
        // false value on "outputs".
        this._outputValues[key] = false;
        value = true;
      } else {
        this._outputValues[key] = value;
      }
      var links = this._outputLinks[key];
      if (links) {
        for (var id in links) {
          var link = links[id];
          if (is_pulse || link.instance.inputs[link.inputKey] !== value) {
            link.instance.inputs[link.inputKey] = value;
            link.instance._invalidate();
          }
        }
      }
    }
  };

  ReactiveInstance.prototype.isRunning = function() {
    return this._numUnlinkedRequiredInputs === 0;
  };

  ReactiveInstance.prototype.isRequiredInput = function(input_key) {
    return inputDefinition[input_key] === Reactive.REQUIRED;
  };

  ReactiveInstance.prototype.getOutputValue = function(output_key) {
    return this._outputValues[output_key];
  };

  ReactiveInstance.prototype.setInputValues = function(value_map) {
    var value_changed = false;
    for (var key in value_map) {
      var value = value_map[key];
      if (value !== undefined &&
          this.inputs === undefined &&
          this.isRequiredInput(key)) {
        this._decrementRequiredLinks();
      }
      if (this.inputs[key] !== value) {
        value_changed = true;
        this.inputs[key] = value;
      }
    }
    if (value_changed) {
      this._invalidate();
    }
    return this;
  };

  // TODO: BUG! If you setInputValue on a required field and then unlink here,
  // it gets set to undefined but isn't required again!
  ReactiveInstance.prototype.unlink = function(input_key) {
    this._unlinkOnly(input_key);
    if (this.inputs[input_key] !== inputDefaults[input_key]) {
      this.inputs[input_key] = inputDefaults[input_key];
      this._invalidate();
    }
  };

  // Protected
  ReactiveInstance.prototype._invalidate = function() {
    if (this._numUnlinkedRequiredInputs || !this._isValid) {
      return;
    }
    this._isValid = false;
    enqueueRun(this);
  };

  ReactiveInstance.prototype._run = function() {
    if (this._numUnlinkedRequiredInputs > 0) {
      throw new Error('Crazy! This can not run because it has unlinked inputs');
    }

    var output = fn.call(this);
    output && this.output(output);

    // Reset pulse values back to false
    for (var ii = 0; ii < pulseKeys.length; ++ii) {
      this.inputs[pulseKeys[ii]] = false;
    }
    this._isValid = true;
  };

  ReactiveInstance.prototype._decrementRequiredLinks = function() {
    if (this._numUnlinkedRequiredInputs === 0) {
      throw new Error('CHAOS! tried to decrement links already at 0.');
    }
    var output_key;
    var links;
    var link_key;
    this._numUnlinkedRequiredInputs--;
    if (this._numUnlinkedRequiredInputs === 0) {
      for (output_key in this._outputLinks) {
        links = this._outputLinks[output_key];
        for (link_key in links) {
          links[link_key].instance._decrementRequiredLinks();
        }
      }
    }
  };

  ReactiveInstance.prototype._incrementRequiredLinks = function() {
    var output_key;
    var links;
    var link_key;
    var was_zero = this._numUnlinkedRequiredInputs === 0;
    this._numUnlinkedRequiredInputs++;
    if (was_zero) {
      for (output_key in this._outputLinks) {
        links = this._outputLinks[output_key];
        for (link_key in links) {
          links[link_key].instance._incrementRequiredLinks();
        }
      }
    }
  };

  ReactiveInstance.prototype._unlinkOnly = function(input_key) {
    var link_info = this._inputLinks[input_key];
    if (link_info) {
      var from = link_info.instance;
      var output_key = link_info.outputKey;

      delete this._inputLinks[input_key];
      delete from._outputLinks[output_key][this.id + input_key];

      if (from.isRunning() && this.isRequiredInput(input_key)) {
        this._incrementRequiredLinks();
      } else if (!from.isRunning() && !this.isRequiredInput(input_key)) {
        this._decrementRequiredLinks();
      }

      // After the unlink, figure out what this is actually dependent on.
      this._calculateDependencies();
    }
  }

  ReactiveInstance.prototype._dependsOn = function(instance) {
    return !!this._dependencies[instance.id];
  }

  ReactiveInstance.prototype._calculateDependencies = function() {
    this._dependencies = {};
    var input_key, input_instance, output_instance;
    var to_inspect = [this];
    while (to_inspect.length) {
      input_instance = to_inspect.pop();
      for (input_key in input_instance._inputLinks) {
        output_instance = input_instance._inputLinks[input_key].instance;
        if (!this._dependencies[output_instance.id]) {
          this._dependencies[output_instance.id] = true;
          to_inspect.push(output_instance);
        }
      }
    }
  };

  // Remove Reactive API from bag.
  delete bag.resolve;
  delete bag.inputs;

  // Transfer custom API to new reactive class.
  for (var key in bag) {
    if (ReactiveInstance.prototype[key]) {
      throw new Error('Reserved key ' + key);
    }
    ReactiveInstance.prototype[key] = bag[key];
  }

  return ReactiveInstance;
};



var totalInstances = 0;
var isRunning = false;
// TODO: use a linked list to manage this queue for perf reasons
var runQueue = [];
var runHistory;

function enqueueRun(instance) {
  // don't enqueue the same instance twice in one pass, protects from infinite
  // recursion
  if (!isRunning || !runHistory[instance.id]) {

    // A priority queue. When a new instance is enqueued to run, it's checked
    // against everything currently in the queue. If an instance already in the
    // queue depends on this new instance, the new instance is inserted before
    // it to ensure proper execution order.
    var inserted = false;
    if (runQueue.length) {
      for (var ii = 0; ii < runQueue.length; ++ii) {
        if (runQueue[ii]._dependsOn(instance)) {
          runQueue.splice(ii,0,instance);
          inserted = true;
          break;
        }
      }
    }
    if (!inserted) {
      runQueue.push(instance);
    }
  }

  if (!isRunning) {
    isRunning = true;
    runHistory = {};
    var runningInstance;
    while (runQueue.length) {
      runningInstance = runQueue.shift();
      if (Reactive.beforeRun) {
        Reactive.beforeRun.call(null, runningInstance);
      }
      runHistory[runningInstance.id] = true;
      runningInstance._run();
    }
    isRunning = false;
  }
}



Reactive.link = function(from, output_key, to, input_key) {
  if (from === to) {
    throw new Error('Cannot link to self.');
  }

  if (to._inputLinks[input_key]) {
    to._unlinkOnly(input_key);
  }

  if (!from._outputLinks[output_key]) {
    from._outputLinks[output_key] = {};
  }
  from._outputLinks[output_key][to.id + input_key] = {
    instance: to,
    inputKey: input_key
  };
  to._inputLinks[input_key] = {
    instance: from,
    outputKey: output_key
  };

  if (from.isRunning() && to.isRequiredInput(input_key)) {
    to._decrementRequiredLinks();
  } else if (!from.isRunning() && !to.isRequiredInput(input_key)) {
    to._incrementRequiredLinks();
  }

  // Ensure everything downstream now has this as a dependency
  var dependencies = {};
  dependencies[from.id] = true;
  for (var dependency in from._dependencies) {
    dependencies[dependency] = true;
  }
  var to_add_to = [to];
  var to_add_to_map = {};
  to_add_to_map[to.id] = true;
  while (to_add_to.length) {
    var instance = to_add_to.pop();
    for (dependency in dependencies) {
      instance._dependencies[dependency] = true;
    }
    for (var output_key in instance._outputLinks) {
      var link_infos = instance._outputLinks[output_key];
      for (var input_id in link_infos) {
        var input_instance = link_infos[input_id].instance;
        if (!to_add_to_map[input_instance.id]) {
          to_add_to_map[input_instance.id] = true;
          to_add_to.push(input_instance);
        }
      }
    }
  }

  if (from._outputValues[output_key] !== undefined) {
    if (to.inputs[input_key] !== from._outputValues[output_key]) {
      to.inputs[input_key] = from._outputValues[output_key];
      to._invalidate();
    }
  }
};

module.exports = Reactive;
