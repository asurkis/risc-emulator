const REGISTER_ADDRESS_BITS = 5;
const REGISTER_COUNT = 1 << REGISTER_ADDRESS_BITS;

const registersTable = {};
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

function shiftPC(val) {
  state.programCounter += val - 1;
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
  // lt: (a, b) => a < b ? 1 : 0,
  sne: (a, b) => a == b ? 0 : 1,
  seq: (a, b) => a == b ? 1 : 0,
  sgeq: (a, b) => a >= b ? 1 : 0,
};

const branching = {
  eq: (a, b) => a == b,
  ne: (a, b) => a != b,
  lt: (a, b) => a < b,
  // ltu: (a, b) => { },
  geq: (a, b) => a >= b,
  // geu: (a, b) => { },
}

const lineVariants = {
  R: {
    regex: /^\s*(\w+)\s+x(\d+)\s*,\s*x(\d+)\s*,\s*x(\d+)\s*(?:#.*)?$/i,
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
    regex: /^\s*(\w+)\s+x(\d+)\s*,\s*x(\d+)\s*,\s*(-?\d+)\s*(?:#.*)?$/i,
    ops: (() => {
      const entries = {};
      const arithmetical = ['add', 'slt', 'and', 'or', 'xor', 'xll', 'xrl', 'sra'];
      for (const key of arithmetical) {
        const fun = arithmetics[key];
        entries[key + 'i'] = (rd, rs1, imm) => {
          const a = getReg(rs1);
          setReg(rd, fun(a, imm));
        };
      }

      for (const branch in branching) {
        const fun = branching[branch];
        entries['b' + branch] = (rs1, rs2, imm) => {
          const a = getReg(rs1);
          const b = getReg(rs2);
          if (fun(a, b)) {
            shiftPC(imm);
          }
        };
      }
      entries['jalr'] = (rd, rs1, imm) => {
        const a = getReg(rs1);
        setReg(rd, state.programCounter);
        state.programCounter = a + imm;
      };
      entries['lw'] = (rd, rs1, imm) => {
        const a = getReg(rs1);
        setReg(rd, state.memory[a + imm]);
      };
      return entries;
    })()
  },
  S: {
    regex: /^\s*(\w+)\s+x(\d+)\s*,\s*x(\d+)\s*,\s*(-?\d+)\s*(?:#.*)?$/i,
    ops: {
      sw: (rs2, rs1, imm) => {
        const a = getReg(rs2);
        const b = getReg(rs1);
        state.memory[b + imm] = a;
      },
    }
  },
  U: {
    regex: /^\s*(\w+)\s+x(\d+)\s*,\s*(-?\d+)\s*(?:#.*)?$/i,
    ops: {
      // lui: (rd, imm) => {},
      // auipc: {},
      // li: {},
      jal: (rd, imm) => {
        setReg(rd, state.programCounter);
        shiftPC(imm);
      },
    }
  },
  ILabel: {
    regex: /^\s*(\w+)\s+x(\d+)\s*,\s*x(\d+)\s*,\s*([a-z_]\w*)\s*(?:#.*)?$/i,
    ops: (() => {
      const entries = {};
      for (const branch in branching) {
        const fun = branching[branch];
        entries['b' + branch] = (rs1, rs2, imm) => {
          const a = getReg(rs1);
          const b = getReg(rs2);
          if (fun(a, b)) {
            shiftPC(imm);
          }
        };
      }
      return entries;
    })()
  },
  ULabel: {
    regex: /^\s*(jal)\s+x(\d+)\s*,\s*([a-z_]\w*)\s*(?:#.*)?$/i,
    ops: {
      // lui: (rd, imm) => {},
      // auipc: {},
      // li: {},
      jal: (rd, imm) => {
        setReg(rd, state.programCounter);
        shiftPC(imm);
      },
    }
  },
  noArg: {
    regex: /^\s*(\w+)\s*(?:#.*)?$/i,
    ops: {
      ehalt: () => { state.isHalted = true; },
      ewrite: () => { programOutput.innerText += String.fromCharCode(getReg(31)); },
    }
  },
  // env1: {
  //   regex: /^\s*(\w+)\s+x(\d+)\s*(?:#.*)?$/,
  //   ops: {
  //     ewrite: () => { console.log() },
  //     eread: () => { console },
  //   }
  // },
  label: {
    regex: /^\s*([a-z_]\w*):\s*(?:#.*)?$/i
  },
  empty: {
    regex: /^\s*(?:#.*)?$/i
  },
};

function updateRegisters() {
  registersTable.pc.innerText = state.programCounter;
  for (const reg in state.registers) {
    registersTable[`x${reg}`].innerText = state.registers[reg];
  }
}

function reloadProgram() {
  state = {
    programCounter: 0,
    registers: new Int32Array(REGISTER_COUNT),
    memory: new Int32Array(1 << 16),
    isHalted: false,
  };
  updateRegisters();

  const labels = {};
  const labelJumps = [];
  const labelBranches = [];
  const errors = [];
  program = [];
  const lines = sourceCode.value.split('\n');

  for (const lineId in lines) {
    const line = lines[lineId];
    let matchedOnce = false;
    for (const type in lineVariants) {
      const variant = lineVariants[type];
      const match = variant.regex.exec(line);
      if (match === null) {
        continue;
      }

      if (type == 'empty') {
        matchedOnce = true;
        break;
      }

      if (type == 'label') {
        matchedOnce = true;
        labels[match[1]] = program.length;
        break;
      }

      const op = match[1];
      if (variant.ops[op] === undefined) {
        // errors.push(`Uknown operator '${op}' of type '${type}' at line ${lineId}`)
        // break;
        continue;
      }

      matchedOnce = true;

      const func = variant.ops[op];
      if (type == 'R') {
        program.push({
          exec: () => func(+match[2], +match[3], +match[4]),
          desc: `${match[1]} x${+match[2]}, x${+match[3]}, x${+match[4]}`,
        });
      } else if (type == 'I') {
        program.push({
          exec: () => func(+match[2], +match[3], +match[4]),
          desc: `${match[1]} x${+match[2]}, x${+match[3]}, ${+match[4]}`,
        });
      } else if (type == 'S') {
        program.push({
          exec: () => func(+match[2], +match[3], +match[4]),
          desc: `${match[1]} x${+match[2]}, x${+match[3]}, ${+match[4]}`,
        });
      } else if (type == 'U') {
        program.push({
          exec: () => func(+match[2], +match[3]),
          desc: `${match[1]} x${+match[2]}, ${+match[3]}`,
        });
      } else if (type == 'ULabel') {
        labelJumps.push({
          pos: program.length,
          lineId,
          func,
          op: match[1],
          rd: match[2],
          label: match[3],
        });
        program.push({});
      } else if (type == 'ILabel') {
        labelBranches.push({
          pos: program.length,
          lineId,
          func,
          op: match[1],
          rs1: match[2],
          rs2: match[3],
          label: match[4],
        });
        program.push({});
      } else if (type == 'noArg') {
        program.push({
          exec: func,
          desc: match[1],
        });
      }
    }

    if (!matchedOnce) {
      errors.push(`Unknown operator format: '${line}' at line ${lineId}`);
    }
  }

  for (const lj of labelJumps) {
    if (labels[lj.label] === undefined) {
      errors.push(`Unknown label '${lj.label}' at line ${lj.lineId}`);
      continue;
    }
    const diff = labels[lj.label] - lj.pos;
    program[lj.pos] = {
      exec: () => lj.func(lj.rd, diff),
      desc: `${lj.op} x${lj.rd}, ${diff} # ${lj.label}`
    };
  }

  for (const lb of labelBranches) {
    if (labels[lb.label] === undefined) {
      errors.push(`Unknown label '${lb.label}' at line ${lb.lineId}`);
      continue;
    }
    const diff = labels[lb.label] - lb.pos;
    program[lb.pos] = {
      exec: () => lb.func(lb.rs1, lb.rs2, diff),
      desc: `${lb.op} x${lb.rs1}, x${lb.rs2}, ${diff} # ${lb.label}`
    };
  }

  if (errors.length == 0) {
    compiledProgram.innerText = program.map((c, i) => `${i}: ${c.desc}`).join('\n');
  } else {
    compiledProgram.innerText = errors.join('\n');
    program = [];
  }
}

function stepOnce() {
  if (program[state.programCounter]) {
    program[state.programCounter++].exec();
  } else {
    state.isHalted = true;
  }
  updateRegisters();
}

function runProgram() {
  if (!state.isHalted) {
    stepOnce();
    setTimeout(runProgram);
  }
}

function stopProgram() {
  state.isHalted = true;
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

  const registersPlaceholder = document.getElementById('registers');
  const table = document.createElement('table');
  let tr = document.createElement('tr');
  let td = document.createElement('td');
  td.innerText = 'pc';
  tr.appendChild(td);
  td = document.createElement('td');
  tr.appendChild(td);
  td.innerText = '0';
  table.appendChild(tr);
  registersTable.pc = td;

  for (let i = 0; i < REGISTER_COUNT; i += 4) {
    tr = document.createElement('tr');

    for (let j = 0; j < 4; ++j) {
      td = document.createElement('td');
      td.innerText = `x${i + j}`;
      tr.appendChild(td);
      td = document.createElement('td');
      td.innerText = '0';
      tr.appendChild(td);
      registersTable[`x${i + j}`] = td;
    }

    table.appendChild(tr);
  }

  registersPlaceholder.appendChild(table);
}

window.onunload = () => {
  localStorage.setItem('savedSource', sourceCode.value);
}
