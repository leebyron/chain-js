var Chain = require('./Chain.js');

var ChainValue = function (value) {
  return new Chain({
    resolve: function (input, output) {
      output({value: value});
    }
  }).newInstance();
};
/*
var ChainAdder = new Chain({
  inputs: {
    a: Chain.REQUIRED,
    b: 1
  },
  resolve: function (input, output) {
    output({
      added: input.a + input.b
    });
  }
});

var ChainAdderInstance = ChainAdder.newInstance();
//console.log(ChainAdderInstance.outputs);

ChainValue(5).linkTo(ChainAdderInstance, 'value', 'a');
//console.log(ChainAdderInstance.outputs);

ChainValue(10).linkTo(ChainAdderInstance, 'value', 'b');
//console.log(ChainAdderInstance.outputs);
*/

///////////////

/*
var ChainIncrementer = new Chain({
  inputs: {
    value: Chain.REQUIRED
  },
  resolve: function (input, output) {
    this.value = (this.value || 0) + input.value;
    output({
      value: this.value
    });
  }
});

var ChainIncrementerInstance = ChainIncrementer.newInstance();

ChainIncrementerInstance.inputs.value = 5;

ChainIncrementerInstance.run();
console.log(ChainIncrementerInstance.outputs);

ChainIncrementerInstance.run();
console.log(ChainIncrementerInstance.outputs);

ChainIncrementerInstance.inputs.value = 20;
ChainIncrementerInstance.run();
console.log(ChainIncrementerInstance.outputs);


//////////////
*/

var First = new Chain({
  resolve: function (input, output) {
    output({
      beer: 10
    });
  }
});

var Second = new Chain({
  inputs: {
    nomnom: Chain.REQUIRED
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
Chain.link(secondInst, 'poopoo', secondInst2, 'nomnom');
Chain.link(firstInst, 'beer', secondInst, 'nomnom');
//console.log(secondInst.outputs);
