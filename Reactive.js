'use strict';

var Reactive = {
  REQUIRED: '__REQUIRED__',
  PULSE: '__PULSE__'
};

Reactive.create = function(bag) {
  var fn = bag.resolve;
  var inputDefinition = bag.inputs || {};
  var inputDefaults = {};

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
    // TODO: better object copy
    this.inputs = JSON.parse(JSON.stringify(inputDefaults));
    this.state = {};

    // protected
    this.id = totalInstances++;
    this.invalid = false;
    this.outputValues = {};
    this.outputLinks = {};
    this.inputLinks = {};
    this.dependencies = {};
    this.unlinkedRequiredInputs = numRequiredInputs;

    Object.seal && Object.seal(this);

    this._invalidate();
  }

  ReactiveInstance.prototype.output = function(values) {
    for (var key in values) {
      var value = values[key];
      var is_pulse = value === Reactive.PULSE;
      if (is_pulse) {
        // A pulse distributes a temporary "true" but is always represented as a
        // false value on "outputs".
        this.outputValues[key] = false;
        value = true;
      } else {
        this.outputValues[key] = value;
      }
      var links = this.outputLinks[key];
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
    return this.unlinkedRequiredInputs === 0;
  };

  ReactiveInstance.prototype.isRequiredInput = function(input_key) {
    return inputDefinition[input_key] === Reactive.REQUIRED;
  };

  ReactiveInstance.prototype.getOutputValue = function(output_key) {
    return this.outputValues[output_key];
  };

  ReactiveInstance.prototype.unlink = function(input_key) {
    this._unlinkOnly(input_key);
    var value_change = this.inputs[input_key] !== inputDefaults[input_key];
    if (value_change) {
      this.inputs[input_key] = inputDefaults[input_key];
      this._invalidate();
    }
  };

  // Protected
  ReactiveInstance.prototype._invalidate = function() {
    if (!this.isRunning() || this.invalid) {
      return;
    }
    this.invalid = true;
    enqueueRun(this);
  };

  ReactiveInstance.prototype._run = function() {
    if (this.unlinkedRequiredInputs > 0) {
      throw new Error('Crazy! This can not run because it has unlinked inputs');
    }
    fn.call(this);
    // Reset pulse values back to false
    for (var ii = 0; ii < pulseKeys.length; ++ii) {
      this.inputs[pulseKeys[ii]] = false;
    }
    this.invalid = false;
  };

  ReactiveInstance.prototype._decrementRequiredLinks = function() {
    if (this.unlinkedRequiredInputs === 0) {
      throw new Error('CHAOS! tried to decrement links already at 0.');
    }
    var output_key;
    var links;
    var link_key;
    this.unlinkedRequiredInputs--;
    if (this.unlinkedRequiredInputs === 0) {
      for (output_key in this.outputLinks) {
        links = this.outputLinks[output_key];
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
    var was_zero = this.unlinkedRequiredInputs === 0;
    this.unlinkedRequiredInputs++;
    if (was_zero) {
      for (output_key in this.outputLinks) {
        links = this.outputLinks[output_key];
        for (link_key in links) {
          links[link_key].instance._incrementRequiredLinks();
        }
      }
    }
  };

  ReactiveInstance.prototype._unlinkOnly = function(input_key) {
    var link_info = this.inputLinks[input_key];
    if (!link_info) {
      throw new Error('Nothing linked to ' + input_key);
    }

    var from = link_info.instance;
    var output_key = link_info.outputKey;

    delete this.inputLinks[input_key];
    delete from.outputLinks[output_key][this.id + input_key];

    if (from.isRunning() && inputDefinition[input_key] === Reactive.REQUIRED) {
      this._incrementRequiredLinks();
    } else if (!from.isRunning() &&
               inputDefinition[input_key] !== Reactive.REQUIRED) {
      this._decrementRequiredLinks();
    }

    // After the unlink, figure out what this is actually dependent on.
    this._calculateDependencies();
  }

  ReactiveInstance.prototype._dependsOn = function(instance) {
    return !!this.dependencies[instance.id];
  }

  ReactiveInstance.prototype._calculateDependencies = function() {
    this.dependencies = {};
    var input_key, input_instance, output_instance;
    var to_inspect = [this];
    while (to_inspect.length) {
      input_instance = to_inspect.pop();
      for (input_key in input_instance.inputLinks) {
        output_instance = input_instance.inputLinks[input_key].instance;
        if (!this.dependencies[output_instance.id]) {
          this.dependencies[output_instance.id] = true;
          to_inspect.push(output_instance);
        }
      }
    }
  };

  // Transfer custom API to new instance.
  // remove Reactive API
  delete bag.resolve;
  delete bag.inputs;
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

  if (to.inputLinks[input_key]) {
    to._unlinkOnly(input_key);
  }

  if (!from.outputLinks[output_key]) {
    from.outputLinks[output_key] = {};
  }
  from.outputLinks[output_key][to.id + input_key] = {
    instance: to,
    inputKey: input_key
  };
  to.inputLinks[input_key] = {
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
  for (var dependency in from.dependencies) {
    dependencies[dependency] = true;
  }
  var to_add_to = [to];
  var to_add_to_map = {};
  to_add_to_map[to.id] = true;
  while (to_add_to.length) {
    var instance = to_add_to.pop();
    for (dependency in dependencies) {
      instance.dependencies[dependency] = true;
    }
    for (var output_key in instance.outputLinks) {
      var link_infos = instance.outputLinks[output_key];
      for (var input_id in link_infos) {
        var input_instance = link_infos[input_id].instance;
        if (!to_add_to_map[input_instance.id]) {
          to_add_to_map[input_instance.id] = true;
          to_add_to.push(input_instance);
        }
      }
    }
  }

  if (from.outputValues[output_key] !== undefined) {
    var value_change = to.inputs[input_key] !== from.outputValues[output_key];
    if (value_change) {
      to.inputs[input_key] = from.outputValues[output_key];
      to._invalidate();
    }
  }
};

module.exports = Reactive;
