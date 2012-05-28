//var copyProperties = require('copyProperties')

function Reactive(bag) {
  this.fn = bag.resolve;
  this.inputDefinition = bag.inputs || {};
  this.inputDefaults = {}

  this.pulseKeys = [];
  this.inputsMissing = 0;

  for (var key in this.inputDefinition) {
    var value = this.inputDefinition[key];
    if (value === Reactive.PULSE) {
      this.inputDefaults[key] = false;
      this.pulseKeys.push(key);
    } else if (value === Reactive.REQUIRED) {
      this.inputDefaults[key] = undefined;
      this.inputsMissing++;
    } else {
      this.inputDefaults[key] = value;
    }
  }
}

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
        if (runQueue[ii].dependsOn(instance)) {
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

// default input values
Reactive.REQUIRED = '__REQUIRED__';
Reactive.PULSE = '__PULSE__';

Reactive.prototype.newInstance = function() {
  return new ReactiveInstance(this);
};

function ReactiveInstance(reactive) {
  this.id = totalInstances++;
  this.invalid = false;

  // TODO: better object copy
  this.inputs = JSON.parse(JSON.stringify(reactive.inputDefaults));

  this.outputs = {};
  this.state = {};
  this.reactive = reactive;
  this.outputLinks = {};
  this.outputFn = output.bind(this);
  this.inputLinks = {};
  this.dependencies = {};
  this.unlinkedRequiredInputs = reactive.inputsMissing;

  if (this.isRunning()) {
    this.invalidate();
  }
}

ReactiveInstance.prototype.isRunning = function() {
  return this.unlinkedRequiredInputs === 0;
};

ReactiveInstance.prototype.invalidate = function() {
  if (this.invalid) {
    return;
  }
  this.invalid = true;
  enqueueRun(this);
};

function output(values) {
  for (key in values) {
    var value = values[key];
    var is_pulse = value === Reactive.PULSE;
    if (is_pulse) {
      // A pulse distributes a temporary "true" but is always represented as a
      // false value on "outputs".
      values[key] = false;
      value = true;
    }
    var links = this.outputLinks[key];
    if (links) {
      for (id in links) {
        var link = links[id];
        if (is_pulse || link.instance.inputs[link.inputKey] !== value) {
          link.instance.inputs[link.inputKey] = value;
          link.instance.invalidate();
        }
      }
    }
  }
  this.outputs = values;
};

ReactiveInstance.prototype._run = function() {
  if (this.unlinkedRequiredInputs > 0) {
    throw new Error('Crazy! This can not run because it has unlinked inputs');
  }
  this.reactive.fn.call(this.state, this.inputs, this.outputFn);
  // Reset pulse values back to false
  for (var ii = 0; ii < this.reactive.pulseKeys.length; ++ii) {
    this.inputs[this.reactive.pulseKeys[ii]] = false;
  }
  this.invalid = false;
};

ReactiveInstance.prototype.decrementRequiredLinks = function() {
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
        links[link_key].instance.decrementRequiredLinks();
      }
    }
  }
};

ReactiveInstance.prototype.incrementRequiredLinks = function() {
  var output_key;
  var links;
  var link_key;
  var was_zero = this.unlinkedRequiredInputs === 0;
  this.unlinkedRequiredInputs++;
  if (was_zero) {
    for (output_key in this.outputLinks) {
      links = this.outputLinks[output_key];
      for (link_key in links) {
        links[link_key].instance.incrementRequiredLinks();
      }
    }
  }
};

ReactiveInstance.prototype.unlink = function(input_key) {
  this._unlinkOnly(input_key);
  var value_change = this.inputs[input_key] !== this.reactive.inputDefaults[input_key];
  if (value_change) {
    this.inputs[input_key] = this.reactive.inputDefaults[input_key];
    if (this.isRunning()) {
      this.invalidate();
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

  if (from.isRunning() &&
      this.reactive.inputDefinition[input_key] === Reactive.REQUIRED) {
    this.incrementRequiredLinks();
  } else if (!from.isRunning() &&
             this.reactive.inputDefinition[input_key] !== Reactive.REQUIRED) {
    this.decrementRequiredLinks();
  }

  // After the unlink, figure out what this is actually dependent on.
  this._calculateDependencies();
}

ReactiveInstance.prototype.dependsOn = function(instance) {
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

  if (from.isRunning() &&
      to.reactive.inputDefinition[input_key] === Reactive.REQUIRED) {
    to.decrementRequiredLinks();
  } else if (!from.isRunning() &&
             to.reactive.inputDefinition[input_key] !== Reactive.REQUIRED) {
    to.incrementRequiredLinks();
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

  if (from.outputs[output_key] !== undefined) {
    var value_change = to.inputs[input_key] !== from.outputs[output_key];
    if (value_change) {
      to.inputs[input_key] = from.outputs[output_key];
      if (to.isRunning()) {
        to.invalidate();
      }
    }
  }
};

module.exports = Reactive;
