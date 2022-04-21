/* Simplified encodings of JAL, JALR, branches!! */

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
  sne: (a, b) => a != b ? 1 : 0,
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
  BLabel: {
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
    regex: /^\s*(\w+)\s+x(\d+)\s*,\s*([a-z_]\w*)\s*(?:#.*)?$/i,
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

function encodeCommand(op, args) {
  let type, opcode, rd, rs1, rs2, imm;
}

function decodeCommand(code) {
  const funct3 = (code >> 12) & 7;
  const funct7 = (code >> 25) & 127;
  const immu = (code >> 12) & 0xFFFFF;
  const immi = (code >> 20) & 0xFFF;
  // 0x000 => 0x0800 => 0x800 => 0
  // 0x7FF => 0x0FFF => 0xFFF => 0x7FF
  // 0x800 => 0x1000 => 0x000 => -0x800
  const immis = (immi + 0x800) % 0x1000 - 0x800;
  const imms =
    (((code >> 7) & 31) << 0) |
    (((code >> 25) & 127) << 5);
  const immss = (imms + 0x800) % 0x1000 - 0x800;
  const immb =
    (((code >> 7) & 1) << 10) |
    (((code >> 8) & 15) << 0) |
    (((code >> 25) & 63) << 4) |
    (((code >> 31) & 1) << 11);
  const immbi = (immb + 0x800) % 0x1000 - 0x800;
  const rd = (code >> 7) & 31;
  const rs1 = (code >> 15) & 31;
  const rs2 = (code >> 20) & 31;
  let op, opdesc;

  switch (code & 0x7F) {
    case 0b0110111: // lui
      return {
        op: `lui x${rd}, ${immu}`,
        desc: `x${rd} := ${immu} * 2^12`,
        eval: () => { setReg(rd, immu << 12); }
      };
    case 0b0010111: // auipc
      return {
        op: `auipc x${rd}, ${immu}`,
        desc: `x${rd} := ${immu} * 2^12 + pc`,
        eval: () => {
          const pc = state.programCounter;
          setReg(rd, (immu << 12) + pc);
        }
      };
    case 0b1101111: // jal
      return {
        op: `jal x${rd}, ${immu}`,
        desc: `x${rd} := pc; pc := pc + ${immu}`,
        eval: () => { shiftPC(immu); }
      };
    case 0b1100111: // jalr
      if (funct3 != 0) {
        return null;
      }
      return {
        op: `jalr x${rd}, x${rs1}, ${immis}`,
        desc: `x${rd} := pc; pc := x${rs1} ${immis < 0 ? '-' : '+'} ${Math.abs(immis)}`,
        eval: () => {
          const a = getReg(rs1);
          setReg(rd, state.programCounter);
          state.programCounter = a + immis;
        }
      };
    case 0b1100011: // beq, bne, blt, bge, bltu, bgeu
      switch (funct3) {
        case 0b000: op = 'eq'; opdesc = '=='; break;
        case 0b001: op = 'ne'; opdesc = '!='; break;
        case 0b100: op = 'lt'; opdesc = '<'; break;
        case 0b101: op = 'geq'; opdesc = '>='; break;
        default: return null;
      }
      return {
        op: `b${op} x${rs1}, x${rs2}, ${immbi}`,
        desc: `if x${rs1} ${opdesc} x${rs2} then pc := pc ${immbi < 0 ? '-' : '+'} ${Math.abs(immbi)}`,
        eval: () => {
          const a = getReg(rs1);
          const b = getReg(rs2);
          if (branching[op](a, b)) {
            shiftPC(immbi);
          }
        }
      };
    case 0b0000011: // lw
      if (funct3 != 0b010) {
        return null;
      }
      return {
        op: `lw x${rd}, x${rs1}, ${immis}`,
        desc: `x${rd} := [x${rs1} + (${immis})]`,
        eval: () => {
          const a = getReg(rs1);
          setReg(rd, state.memory[a + immis]);
        }
      };
    case 0b0100011: // sw
      if (funct3 != 0b010) {
        return null;
      }
      return {
        op: `sw x${rs1}, x${rs2}, ${immss}`,
        desc: `[x${rs1} + ${immss}] := x${rs2}`,
        eval: () => {
          const a = getReg(rs1);
          const b = getReg(rs2);
          state.memory[a + immss] = b;
        }
      };
    case 0b0010011: // addi, slti, sltiu, xori, ori, andi, slli, srli, srai
      switch (funct3) {
        case 0b000: op = 'add'; opdesc = '+'; break;
        // case 0b010: op = 'slt'; opdesc = '<'; break;
        // case 0b100: op =
      }
      return {
        op: `${op}i x${rd}, x${rs1}, ${immis}`,
        desc: `x${rd} := x${rs1} + (${immis})`,
        eval: () => {
          const a = getReg(rs1);
          setReg(rd, a + immis);
        }
      };
    case 0b0110011: // add, sub, sll, slt, sltu, xor, srl, sra, or, and, mul, div, rem
      switch (funct3 | (funct7 << 3)) {
        case 0b0000000_000: op = 'add'; opdesc = '+'; break;
        case 0b0100000_000: op = 'sub'; opdesc = '-'; break;
        case 0b0000000_001: op = 'sll'; opdesc = '<<'; break;
        case 0b0000000_010: op = 'slt'; opdesc = '<'; break;
        case 0b0000001_010: op = 'seq'; opdesc = '=='; break;
        case 0b0000011_010: op = 'sne'; opdesc = '!='; break;
        case 0b0000010_010: op = 'sgeq'; opdesc = '>='; break;
        case 0b0000000_100: op = 'xor'; opdesc = 'xor'; break;
        case 0b0000000_101: op = 'srl'; opdesc = '>>'; break;
        case 0b0100000_101: op = 'sra'; opdesc = '>>>'; break;
        case 0b0000000_110: op = 'or'; opdesc = 'or'; break;
        case 0b0000000_111: op = 'and'; opdesc = 'and'; break;
        case 0b0000001_000: op = 'mul'; opdesc = '*'; break;
        case 0b0000001_100: op = 'div'; opdesc = '/'; break;
        case 0b0000001_110: op = 'rem'; opdesc = '%'; break;
      }
      return {
        op: `${op} x${rd}, x${rs1}, x${rs2}`,
        desc: `x${rd} := x${rs1} + x${rs2}`,
        eval: () => {
          const a = getReg(rs1);
          const b = getReg(rs2);
          setReg(rd, a + b);
        }
      };
  }
  return null;
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
      } else if (type == 'BLabel') {
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
