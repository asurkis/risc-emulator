let sourceCode;
let compiledProgram;
let programOutput;

let state;
let program;

function clearOutput() {
  programOutput.innerText = '';
}

function reloadProgram() {
  state = {
    programCounter: 0,
    registers: Array(32).fill(0),
    isHalted: false,
  };

  commands = [];
  labels = [];
  errors = [];

  for (const line of sourceCode.value.split('\n')) {
    const add = /^\s*add(\s+x\d+){3}\s*(#.*)?$/i;
    console.log(line, add.test(line));
  }
}

function stepOnce() {

}

function runProgram() {
  while (!state.isHalted) {
    stepOnce();
  }
}

function reloadAndRun() {
  reloadProgram();
  runProgram();
}

window.onload = () => {
  sourceCode = document.querySelector('textarea');
  compiledProgram = document.getElementById('compiledProgram');
  programOutput = document.getElementById('programOutput');
}
