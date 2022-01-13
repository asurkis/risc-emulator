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
  sub: (a, b) => a - b,
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

const lineVariants = {
  R: {
    regex: /^\s*(\w+)\s+x(\d+),\s*x(\d+),\s*x(\d+)\s*(?:#.*)?/i,
    ops: Object.fromEntries(Object.entries(arithmetics).map(([op, fun]) => [
      op,
      (rd, rs1, rs2) => {
        const a = getReg(rs1);
        const b = getReg(rs2);
        setReg(rd, fun(a, b));
      }
    ]))
  },
  I: {
    regex: /^\s*(\w+)\s+x(\d+),\s*x(\d+),\s*(-?\d+)\s*(?:#.*)?/i,
    ops: (() => {
      const entries = [
        'add',
        'slt',
        'and',
        'or',
        'xor',
        'sll',
        'srl',
        'sra',
      ].map(key => {
        const fun = arithmetics[key];
        return [
          key + 'i',
          (rd, rs1, imm) => {
            const a = getReg(rs1);
            setReg(rd, fun(a, imm));
          }
        ]
      });
      entries.push(['jalr', (rd, rs1, imm) => {
        const a = getReg(rs1);
        setReg(rd, state.programCounter);
        state.programCounter += a + imm - 1;
      }]);
      entries.push(['lw', (rd, rs1, imm) => {
        const a = getReg(rs1);
        setReg(rd, state.memory[rs1 + imm]);
      }]);
      return Object.fromEntries(entries);
    })()
  },
  S: {
    regex: /^\s*(\w+)\s+x(\d+),\s*(-?\d+),\s*x(\d+)\s*(?:#.*)?/i,
    ops: {
      sw: (rs2, rs1, imm) => {
        const a = getReg(rs2);
        const b = getReg(rs1);
        state.memory[b + imm] = a;
      },
    }
  },
  U: {
    regex: /^\s*(\w+)\s+x(\d+),\s*(-?\d+)\s*(?:#.*)?/i,
    ops: {
      // lui: (rd, imm) => {},
      // auipc: {},
      // li: {},
      jal: (rd, imm) => {
        setReg(rd, state.programCounter);
        state.programCounter += imm - 1;
      },
    }
  },
  labelJump: {
    regex: /^\s*(jal)\s+x(\d+),\s*([a-z]\w+)\s*(?:#.*)?/i,
    ops: {
      // lui: (rd, imm) => {},
      // auipc: {},
      // li: {},
      jal: (rd, imm) => {
        setReg(rd, state.programCounter);
        state.programCounter += imm - 1;
      },
    }
  },
  // env0: {
  //   regex: /^\s*(\w+)\s*(?:#.*)?$/,
  //   ops: {
  //     ehalt: () => { state.isHalted = true; }
  //   }
  // },
  // env1: {
  //   regex: /^\s*(\w+)\s+x(\d+)\s*(?:#.*)?$/,
  //   ops: {
  //     ewrite: () => { console.log() },
  //     eread: () => { console },
  //   }
  // },
  label: {
    regex: /^\s*([a-z]\w*):\s*(?:#.*)?$/i
  },
  empty: {
    regex: /^\s*(?:#.*)?$/i
  },
};

function reloadProgram() {
  state = {
    programCounter: 0,
    registers: new Int32Array(REGISTER_COUNT),
    memory: new Int32Array(1 << 16),
    isHalted: false,
  };

  const labels = {};
  const labelJumps = [];
  const errors = [];
  program = [];
  const lines = sourceCode.value.split('\n');

  for (let lineId = 0; lineId < lines.length; ++lineId) {
    const line = lines[lineId];
    let matchedOnce = false;
    for (const type in lineVariants) {
      const variant = lineVariants[type];
      const match = variant.regex.exec(line);
      if (!match) {
        continue;
      }

      matchedOnce = true;
      if (type == 'empty') {
        break;
      }
      if (type == 'label') {
        labels[match[1]] = program.length;
        break;
      }

      const op = match[1];
      if (!variant.ops[op]) {
        errors.push(`Uknown operator '${op}' of type '${type}' at line ${lineId}`)
        break;
      }

      const func = variant.ops[op];
      if (type == 'U') {
        program.push({
          exec: () => func(+match[2], +match[3]),
          desc: `${match[1]}\t${+match[2]}\t${+match[3]}`,
        });
      } else if (type == 'labelJump') {
        labelJumps.push({ pos: program.length, label: match[3], lineId, rd: match[1], func });
        program.push({});
      } else {
        program.push({
          exec: () => func(+match[2], +match[3], +match[4]),
          desc: `${match[1]}\t${+match[2]}\t${+match[3]}\t${+match[4]}`,
        });
      }
    }

    if (!matchedOnce) {
      errors.push(`Unknown operator format: '${line}' at line ${lineId}`);
    }
  }

  for (const lj of labelJumps) {
    if (!labels[lj.label]) {
      errors.push(`Unknown label '${match[3]}' at line ${lineId}`);
      continue;
    }
    program[lj.pos] = {
      exec: () => lj.func(lj.rd, labels[lj.label]),
      desc: `jal ${lj.rd}, ${labels[lj.label]} # ${lj.label}`
    }
  }

  if (errors.length == 0) {
    console.log({ program });
  } else {
    console.log({ errors });
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

  sourceCode.value = localStorage.getItem('savedSource');
}

window.onunload = () => {
  localStorage.setItem('savedSource', sourceCode.value);
}
