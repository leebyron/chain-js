var Reactive = require('./Reactive.js');

var ReactiveValue = function (value) {
  return new Reactive({
    resolve: function (input, output) {
      output({value: value});
    }
  }).newInstance();
};
/*
var ReactiveAdder = new Reactive({
  inputs: {
    a: Reactive.REQUIRED,
    b: 1
  },
  resolve: function (input, output) {
    output({
      added: input.a + input.b
    });
  }
});

var reactiveAdderInstance = ReactiveAdder.newInstance();
//console.log(reactiveAdderInstance.outputs);

ReactiveValue(5).linkTo(reactiveAdderInstance, 'value', 'a');
//console.log(reactiveAdderInstance.outputs);

ReactiveValue(10).linkTo(reactiveAdderInstance, 'value', 'b');
//console.log(reactiveAdderInstance.outputs);
*/

///////////////

/*
var ReactiveIncrementer = new Reactive({
  inputs: {
    value: Reactive.REQUIRED
  },
  resolve: function (input, output) {
    this.value = (this.value || 0) + input.value;
    output({
      value: this.value
    });
  }
});

var reactiveIncrementerInstance = ReactiveIncrementer.newInstance();

reactiveIncrementerInstance.inputs.value = 5;

reactiveIncrementerInstance.run();
console.log(reactiveIncrementerInstance.outputs);

reactiveIncrementerInstance.run();
console.log(reactiveIncrementerInstance.outputs);

reactiveIncrementerInstance.inputs.value = 20;
reactiveIncrementerInstance.run();
console.log(reactiveIncrementerInstance.outputs);


//////////////
*/

var First = new Reactive({
  resolve: function (input, output) {
    output({
      beer: 10
    });
  }
});

var Second = new Reactive({
  inputs: {
    nomnom: Reactive.REQUIRED
  },
  resolve: function (input, output) {
    output({
      poopoo: input.nomnom * 5
    });
  }
});

var firstInst = First.newInstance();
var secondInst = Second.newInstance();
var secondInst2 = Second.newInstance();
Reactive.link(secondInst, 'poopoo', secondInst2, 'nomnom');
Reactive.link(firstInst, 'beer', secondInst, 'nomnom');
//console.log(secondInst.outputs);
