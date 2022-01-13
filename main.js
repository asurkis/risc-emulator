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
    isHalted: false,
  };
  program = [];

  for (const line of sourceCode.value.split('\n')) {
    console.log(line);
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
