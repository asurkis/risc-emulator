const REGISTER_ADDRESS_BITS = 5;
const REGISTER_COUNT = 1 << REGISTER_ADDRESS_BITS;

let sourceCode;
let compiledProgram;
let programOutput;

let state;
let program;

function clearOutput() {
  programOutput.innerText = '';
}

function getReg(addr) {
  return addr == 0 ? 0 : state.registers[addr];
}

function setReg(addr, val) {
  if (addr != 0) {
    state.registers[addr] = val;
  }
}

const arithmetics = {
  add: (a, b) => a + b,
  slt: (a, b) => a < b ? 1 : 0,
  and: (a, b) => a & b,
  or: (a, b) => a | b,
  xor: (a, b) => a ^ b,
  sll: (a, b) => a << b,
  srl: (a, b) => a >> b,
  sra: (a, b) => a >>> b,
  mul: (a, b) => a * b,
  // mulh: (a, b) => a * b,
  // mulhu: (a, b) => a * b,
  // mulhsu: (a, b) => a * b,
  div: (a, b) => a / b,
  // divu: (a, b) => a + b,
  rem: (a, b) => a % b,
  // remu: (a, b) => a + b,
};

const commandVariants = {
  R: {
    regex: /^\s*(\w+)\s+x(\d+)\s+x(\d+)\s+x(\d+)\s*(#.*)?/i,
    ops: Object.fromEntries(Object.entries(arithmetics).map((op, fun) => [op, (rd, rs1, rs2) => {
      const a = getReg(rs1);
      const b = getReg(rs2);
      setReg(rd, fun(a, b));
    }]))
  },
  I: {
    regex: /^\s*(\w+)\s+x(\d+)\s+x(\d+)\s+(-?\d+)\s*(#.*)?/i,
    ops: {
      addi: (a, b) => a + b,
      slti: (a, b) => a < b ? 1 : 0,
      andi: (a, b) => a & b,
      ori: (a, b) => a | b,
      xori: (a, b) => a ^ b,
      slli: (a, b) => a << b,
      srli: (a, b) => a >> b,
      srai: (a, b) => a >>> b,
      jalr: (a, b) => 0,
      lw: (a, b) => 0,
    }
  },
  S: {
    regex: /^\s*(\w+)\s+x(\d+)\s+(-?\d+)\s+x(\d+)\s*(#.*)?/i,
    ops: {
      sw: (rs2, rs1, imm) => {
        const a = getReg(rs2);
        const b = getReg(rs1);
      },
    }
  },
  U: {
    regex: /^\s*(\w+)\s+x(\d+)\s+(-?\d+)\s*(#.*)?/i,
    ops: {
      lui: {},
      auipc: {},
      li: {},
      jal: {},
    }
  },
};

function reloadProgram() {
  state = {
    programCounter: 0,
    registers: new Int32Array(REGISTER_COUNT),
    isHalted: false,
  };

  commands = [];
  labels = [];
  errors = [];

  for (const line of sourceCode.value.split('\n')) {
    const add = /^\s*add\s+x(\d+)\s+x(\d+)\s+x(\d+)\s*(#.*)?$/i;
    console.log([add.exec(line), add.test(line), line]);
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
