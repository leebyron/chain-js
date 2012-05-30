'use strict';

var Chain = {
  REQUIRED: '__REQUIRED__',
  PULSE: '__PULSE__'
};

Chain.create = function(bag) {
  var fn = bag.resolve;
  var inputDefinition = bag.inputs || {};
  var inputDefaults = {};
  var stateDefaults = bag.state || {};
  var stateIsFn = bag.state instanceof Function;

  var outputDefinition = bag.outputs || {value: 1};
  // TODO: actually check for a scalar? We need a way to type the single output
  var isOutputValueOnly = bag.outputs === undefined;

  var pulseKeys = [];
  var numRequiredInputs = 0;

  for (var key in inputDefinition) {
    var value = inputDefinition[key];
    if (value === Chain.PULSE) {
      inputDefaults[key] = false;
      pulseKeys.push(key);
    } else if (value === Chain.REQUIRED) {
      inputDefaults[key] = undefined;
      numRequiredInputs++;
    } else {
      inputDefaults[key] = value;
    }
  }

  function ChainInstance() {
    this.id = totalInstances++;
    // TODO: better object copy
    this.inputs = JSON.parse(JSON.stringify(inputDefaults));
    if (stateIsFn) {
      this.state = stateDefaults.apply(this, arguments);
    } else {
      this.state = JSON.parse(JSON.stringify(stateDefaults));
    }
    Object.seal && Object.seal(this.state);

    // for debugging use only.
    this.beforeRun = null;

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

  ChainInstance.prototype.output = function(values) {
    if (isOutputValueOnly) {
      values = {value:values};
    }
    for (var key in values) {
      if (outputDefinition[key] === undefined) {
        throw new Error('Unknown output ' + key);
      }
      var value = values[key];
      // TODO: should have an output definition which makes pulse easier
      // to handle.
      var is_pulse = value && outputDefinition[key] === Chain.PULSE;
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

  ChainInstance.prototype.definesInput = function(key) {
    return inputDefinition[key] !== undefined;
  };

  ChainInstance.prototype.definesOutput = function(key) {
    return outputDefinition[key] !== undefined;
  };

  ChainInstance.prototype.isRunning = function() {
    return this._numUnlinkedRequiredInputs === 0;
  };

  ChainInstance.prototype.isRequiredInput = function(input_key) {
    return inputDefinition[input_key] === Chain.REQUIRED;
  };

  ChainInstance.prototype.getOutputValue = function(output_key) {
    return this._outputValues[output_key];
  };

  ChainInstance.prototype.setInputValues = function(value_map) {
    var value_changed = false;
    for (var key in value_map) {
      var value = value_map[key];
      if (this.inputs[key] !== value) {
        if (this.isRequiredInput(key)) {
          if (this.inputs[key] === undefined) {
            this._decrementRequiredLinks();
          } else if (value === undefined) {
            this._incrementRequiredLinks();
          }
        }
        value_changed = true;
        // A pulse distributes a temporary "true" which will be returned to
        // "false" after execution.
        var is_pulse = value && outputDefinition[key] === Chain.PULSE;
        this.inputs[key] = is_pulse ? true : value;
      }
    }
    if (value_changed) {
      this._invalidate();
    }
    return this;
  };

  ChainInstance.prototype.unlink = function(input_key) {
    this._unlinkOnly(input_key);
    if (this.inputs[input_key] !== inputDefaults[input_key]) {
      this.inputs[input_key] = inputDefaults[input_key];
      this._invalidate();
    }
  };

  // Protected
  ChainInstance.prototype._invalidate = function() {
    if (this._numUnlinkedRequiredInputs || !this._isValid) {
      return;
    }
    this._isValid = false;
    enqueueRun(this);
  };

  ChainInstance.prototype._run = function() {
    if (this._numUnlinkedRequiredInputs > 0) {
      throw new Error('Crazy! This can not run because it has unlinked inputs');
    }

    this.beforeRun && this.beforeRun(this);
    var output = fn.call(this);
    output && this.output(output);

    // Reset pulse values back to false
    for (var ii = 0; ii < pulseKeys.length; ++ii) {
      this.inputs[pulseKeys[ii]] = false;
    }
    this._isValid = true;
  };

  ChainInstance.prototype._decrementRequiredLinks = function() {
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

  ChainInstance.prototype._incrementRequiredLinks = function() {
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

  ChainInstance.prototype._unlinkOnly = function(input_key) {
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

    // If there was no actual input link, but there is a manually set value,
    // and this is a required key, the contract is that this input will be set
    // to it's default undefined value, which means we need to increment the
    // number of required links.
    } else if (this.inputs[input_key] !== undefined &&
               this.isRequiredInput(input_key)) {
      this._incrementRequiredLinks();
    }
  }

  ChainInstance.prototype._dependsOn = function(instance) {
    return !!this._dependencies[instance.id];
  }

  ChainInstance.prototype._calculateDependencies = function() {
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

  // Remove Chain API from bag.
  delete bag.resolve;
  delete bag.inputs;

  // Transfer custom API to new Chain class.
  for (var key in bag) {
    if (ChainInstance.prototype[key]) {
      throw new Error('Reserved key ' + key);
    }
    ChainInstance.prototype[key] = bag[key];
  }

  return ChainInstance;
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
      if (Chain.beforeRun) {
        Chain.beforeRun.call(null, runningInstance);
      }
      runHistory[runningInstance.id] = true;
      runningInstance._run();
    }
    isRunning = false;
  }
}



Chain.link = function(from, output_key, to, input_key) {
  if (from === to) {
    throw new Error('Cannot link to self.');
  }
  if (!from.definesOutput(output_key)) {
    throw new Error('Unknown output ' + output_key);
  }
  if (!to.definesInput(input_key)) {
    throw new Error('Unknown input ' + input_key);
  }

  // Ensure we're about to link to an open slot by unlinking whatever was just
  // there. Alternatively we could throw if the value was set, but this is both
  // safer (easier to track dependencies) and more convenient.
  to._unlinkOnly(input_key);

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

module.exports = Chain;
