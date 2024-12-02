/* Simplified encodings of JAL, JALR, branches!! */

const REGISTER_ADDRESS_BITS = 5;
const MEMORY_PAGE_SIZE = 16;
const REGISTER_COUNT = 1 << REGISTER_ADDRESS_BITS;
const MEMORY_SIZE = 1 << 16;

const registersTable = {};
let sourceCode;
let memoryTable;
let memoryTableBody;
let errorList;
let programInput;
let programOutput;

let tableShift = 0;
const tablePage = [];

const state = {
  programCounter: 0,
  registers: new Int32Array(REGISTER_COUNT),
  memory: new Int32Array(1 << 16),
  commands: new Array(1 << 16).map(_ => null),
  readPos: 0,
  isHalted: false,
};

function clearOutput() {
  programOutput.value = '';
}

function getReg(addr) {
  return addr === 0 ? 0 : state.registers[addr];
}

function setReg(addr, val) {
  if (addr != 0) {
    state.registers[addr] = val;
  }
}

function getHex(val, digits) {
  let hex = (val >>> 0).toString(16).toUpperCase();
  hex = hex.padStart(digits, '0');
  if (hex.length <= 5) {
    return hex;
  }
  let result = '';
  const mod = hex.length % 4;
  const sep = '&nbsp;';
  if (mod !== 0) {
    result += sep + hex.slice(0, mod);
  }
  for (i = mod; i < hex.length; i += 4) {
    result += sep + hex.slice(i, i + 4);
  }
  return result.slice(sep.length);
}

function updateMemoryTable() {
  for (let i = 0; i < MEMORY_PAGE_SIZE; ++i) {
    const addr = i + tableShift;
    const val = getMem(addr);
    const row = tablePage[i];
    row.address.innerHTML = getHex(addr, 4);
    row.hex.innerHTML = getHex(val, 8);
    row.decimal.innerText = '' + val;

    if (addr === state.programCounter) {
      row.tr.style.backgroundColor = '#bfb';
    } else {
      row.tr.style.backgroundColor = '';
    }

    const cmd = state.commands[addr];
    if (cmd) {
      row.command.innerText = cmd.op;
      row.explanation.innerText = cmd.desc;
    } else {
      row.command.innerText = '';
      row.explanation.innerText = '';
    }
  }
}

function getMem(addr) {
  return state.memory[addr];
}

function setMem(addr, val) {
  state.memory[addr] = val;
  state.commands[addr] = decodeCommand(state.memory[addr]);
}

function shiftPC(val) {
  state.programCounter += val;
}

function signExtend(val, bits) {
  const mid = 1 << (bits - 1);
  const high = mid << 1;
  return (val + mid) % high - mid;
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
  mul: (a, b) => {
    const al = a & 0xFFFF;
    const ah = (a >>> 16) & 0xFFFF;
    const bl = b & 0xFFFF;
    const bh = (b >>> 16) & 0xFFFF;
    const cl = al * bl;
    const ch = al * bh + bl * ah;
    return cl + (ch << 16);
  },
  div: (a, b) => a / b,
  rem: (a, b) => a % b,
  sne: (a, b) => a !== b ? 1 : 0,
  seq: (a, b) => a === b ? 1 : 0,
  sge: (a, b) => a >= b ? 1 : 0,
};

const branching = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  lt: (a, b) => a < b,
  ge: (a, b) => a >= b,
}

const lineVariants = {
  R: {
    regex: /^\s*(\w+)\s+x(\d+)\s*,\s*x(\d+)\s*,\s*x(\d+)\s*(?:#.*)?$/i,
    ops: [
      'add', 'sub', 'sll', 'slt', 'seq', 'sne', 'sge',
      'xor', 'srl', 'sra', 'or', 'and', 'mul', 'div', 'rem'
    ]
  },
  I: {
    regex: /^\s*(\w+)\s+x(\d+)\s*,\s*x(\d+)\s*,\s*(-?\d+)\s*(?:#.*)?$/i,
    ops: ['jalr', 'lw', 'addi', 'xori', 'beq', 'bne', 'blt', 'bge']
  },
  S: {
    regex: /^\s*(\w+)\s+x(\d+)\s*,\s*(-?\d+)\s*,\s*x(\d+)\s*(?:#.*)?$/i,
    ops: ['sw']
  },
  U: {
    regex: /^\s*(\w+)\s+x(\d+)\s*,\s*(-?\d+)\s*(?:#.*)?$/i,
    ops: ['li', 'lui', /* 'auipc', */ 'jal']
  },
  BLabel: {
    regex: /^\s*(\w+)\s+x(\d+)\s*,\s*x(\d+)\s*,\s*([a-z_]\w*)\s*(?:#.*)?$/i,
    ops: ['beq', 'bne', 'blt', 'bge']
  },
  ULabel: {
    regex: /^\s*(\w+)\s+x(\d+)\s*,\s*([a-z_]\w*)\s*(?:#.*)?$/i,
    ops: ['li', 'jal']
  },
  noArg: {
    regex: /^\s*(\w+)\s*(?:#.*)?$/i,
    ops: ['ebreak']
  },
  env1: {
    regex: /^\s*(\w+)\s*x(\d+)\s*(?:#.*)?$/i,
    ops: ['eread', 'ewrite']
  },
  data: {
    regex: /^\s*data\s+([+-]?\d+)\s*\*\s*(\d+)\s*(?:#.*)?$/i,
  },
  label: {
    regex: /^\s*([a-z_]\w*):\s*(?:#.*)?$/i
  },
  empty: {
    regex: /^\s*(?:#.*)?$/i
  },
};

function updateRegisters() {
  registersTable.pc.innerText = getHex(state.programCounter, 4);
  for (const reg in state.registers) {
    registersTable[`x${reg}`].innerText = state.registers[reg];
  }
}

function encodeCommand(op, args) {
  if (op === 'data') {
    return args[0];
  }

  let type, opcode, rd, rs1, rs2, imm, funct3, funct7;
  switch (op) {
    case 'lui': opcode = 0b0110111; break;
    case 'jal': opcode = 0b1101111; break;
    case 'jalr': opcode = 0b1100111; funct3 = 0b000; break;
    case 'beq': opcode = 0b1100011; funct3 = 0b000; break;
    case 'bne': opcode = 0b1100011; funct3 = 0b001; break;
    case 'blt': opcode = 0b1100011; funct3 = 0b100; break;
    case 'bge': opcode = 0b1100011; funct3 = 0b101; break;
    case 'lw': opcode = 0b0000011; funct3 = 0b010; break;
    case 'sw': opcode = 0b0100011; funct3 = 0b010; break;
    case 'addi': opcode = 0b0010011; funct3 = 0b000; break; // , slti, sltiu, xori, ori, andi, slli, srli, srai
    case 'xori': opcode = 0b0010011; funct3 = 0b100; break;
    case 'add': opcode = 0b0110011; funct3 = 0b000; funct7 = 0b0000000; break;
    case 'sub': opcode = 0b0110011; funct3 = 0b000; funct7 = 0b0100000; break;
    case 'sll': opcode = 0b0110011; funct3 = 0b001; funct7 = 0b0000000; break;
    case 'slt': opcode = 0b0110011; funct3 = 0b010; funct7 = 0b0000000; break;
    case 'seq': opcode = 0b0110011; funct3 = 0b010; funct7 = 0b0000001; break;
    case 'sne': opcode = 0b0110011; funct3 = 0b010; funct7 = 0b0000011; break;
    case 'sge': opcode = 0b0110011; funct3 = 0b010; funct7 = 0b0000010; break;
    case 'xor': opcode = 0b0110011; funct3 = 0b100; funct7 = 0b0000000; break;
    case 'srl': opcode = 0b0110011; funct3 = 0b101; funct7 = 0b0000000; break;
    case 'sra': opcode = 0b0110011; funct3 = 0b101; funct7 = 0b0100000; break;
    case 'or': opcode = 0b0110011; funct3 = 0b110; funct7 = 0b0000000; break;
    case 'and': opcode = 0b0110011; funct3 = 0b111; funct7 = 0b0000000; break;
    case 'mul': opcode = 0b0110011; funct3 = 0b000; funct7 = 0b0000001; break;
    case 'div': opcode = 0b0110011; funct3 = 0b100; funct7 = 0b0000001; break;
    case 'rem': opcode = 0b0110011; funct3 = 0b110; funct7 = 0b0000001; break;

    case 'ebreak': opcode = 0b1110011; funct7 = 1; break;
    case 'eread': opcode = 0b1110011; funct7 = 2; break;
    case 'ewrite': opcode = 0b1110011; funct7 = 4; break;
    default: return 0;
  }

  switch (opcode) {
    case 0b0110111: type = 'U'; break;
    case 0b0010111: type = 'U'; break;
    case 0b1101111: type = 'U'; break;
    case 0b1100111: type = 'I'; break;
    case 0b1100011: type = 'B'; break;
    case 0b0000011: type = 'I'; break;
    case 0b0100011: type = 'S'; break;
    case 0b0010011: type = 'I'; break;
    case 0b0110011: type = 'R'; break;
    case 0b1110011: type = 'E'; break;
  }

  switch (type) {
    case 'R':
      rd = args[0] & 31;
      rs1 = args[1] & 31;
      rs2 = args[2] & 31;
      return (
        opcode |
        (rd << 7) |
        (funct3 << 12) |
        (funct7 << 25) |
        (rs1 << 15) |
        (rs2 << 20)
      );
    case 'I':
      rd = args[0] & 31;
      rs1 = args[1] & 31;
      imm = signExtend(args[2], 12);
      return (
        opcode |
        (funct3 << 12) |
        (rd << 7) |
        (rs1 << 15) |
        (imm << 20)
      );
    case 'S':
      rs1 = args[0] & 31;
      rs2 = args[2] & 31;
      imm = signExtend(args[1], 12);
      return (
        opcode |
        (funct3 << 12) |
        (rs1 << 15) |
        (rs2 << 20) |
        (((imm >> 0) & 31) << 7) |
        (((imm >> 5) & 127) << 25)
      );
    case 'B':
      rs1 = args[0] & 31;
      rs2 = args[1] & 31;
      imm = signExtend(args[2], 12);
      return (
        opcode |
        (funct3 << 12) |
        (rs1 << 15) |
        (rs2 << 20) |
        (((imm >> 10) & 1) << 7) |
        (((imm >> 0) & 15) << 8) |
        (((imm >> 4) & 63) << 25) |
        (((imm >> 11) & 1) << 31)
      );
    case 'U':
      rd = args[0] & 31;
      imm = args[1] & 0xFFFFF;
      return (
        opcode |
        (rd << 7) |
        (imm << 12)
      );
    case 'E':
      switch (op) {
        case 'ebreak':
          return opcode | (1 << 20);
        case 'eread':
          rd = args[0] & 31;
          return opcode | (rd << 7) | (2 << 20);
        case 'ewrite':
          rs1 = args[0] & 31;
          return opcode | (rs1 << 15) | (4 << 20);
      }
  }
}

function textReg(reg) {
  return reg === 0 ? '0' : `x${reg}`;
}

function textImm(imm) {
  return imm < 0 ? `(${imm})` : `${imm}`;
}

function textAddi(rs1, imm) {
  if (rs1 === '0') {
    return `${imm}`;
  } else {
    if (imm < 0) {
      return `${rs1} - ${-imm}`;
    } else if (imm > 0) {
      return `${rs1} + ${imm}`;
    } else {
      return `${rs1}`;
    }
  }
}

function textRegImm(rs1, imm, opdesc) {
  return `${textReg(rs1)} ${opdesc} ${textImm(imm)}`;
}

function textRegReg(rs1, rs2, opdesc) {
  return `${textReg(rs1)} ${opdesc} ${textReg(rs2)}`;
}

function describeAssignment(rd, textExpr) {
  if (rd === '0') {
    return '<nop>';
  } else {
    return `${rd} := ${textExpr}`;
  }
}

function decodeCommand(code) {
  const funct3 = (code >> 12) & 7;
  const funct7 = (code >> 25) & 127;
  const immu = (code >> 12) & 0xFFFFF;
  const immus = signExtend(immu, 20);
  const immi = (code >> 20) & 0xFFF;
  const immis = signExtend(immi, 12);
  const imms =
    (((code >> 7) & 31) << 0) |
    (((code >> 25) & 127) << 5);
  const immss = signExtend(imms, 12);
  const immb =
    (((code >> 7) & 1) << 10) |
    (((code >> 8) & 15) << 0) |
    (((code >> 25) & 63) << 4) |
    (((code >> 31) & 1) << 11);
  const immbi = signExtend(immb, 12);
  const rd = (code >> 7) & 31;
  const rs1 = (code >> 15) & 31;
  const rs2 = (code >> 20) & 31;
  let op, opdesc;

  switch (code & 0x7F) {
    case 0b0110111: // lui
      return {
        op: `lui x${rd}, ${immu}`,
        desc: describeAssignment(textReg(rd), `${immu} * 2^12`),
        eval: () => { setReg(rd, immu << 12); }
      };
    // case 0b0010111: // auipc
    //   return {
    //     op: `auipc x${rd}, ${immu}`,
    //     desc: describeAssignment(rd, `${immu} * 2^12 + pc`),
    //     eval: () => {
    //       const pc = state.programCounter;
    //       setReg(rd, (immu << 12) + pc);
    //     }
    //   };
    case 0b1101111: // jal
      return {
        op: `jal x${rd}, ${immus}`,
        desc: (rd === 0 ? '' : `x${rd} := pc; `) + describeAssignment('pc', textAddi('pc', immus)),
        eval: () => {
          setReg(rd, state.programCounter);
          shiftPC(immus);
        }
      };
    case 0b1100111: // jalr
      if (funct3 != 0) {
        return null;
      }
      return {
        op: `jalr x${rd}, x${rs1}, ${immis}`,
        desc: (rd === 0 ? '' : `x${rd} := pc; `) + describeAssignment('pc', textAddi(rs1, immis)),
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
        case 0b101: op = 'ge'; opdesc = '>='; break;
        default: return null;
      }
      return {
        op: `b${op} x${rs1}, x${rs2}, ${immbi}`,
        desc: `if x${rs1} ${opdesc} x${rs2} then ${describeAssignment('pc', textAddi('pc', immbi))}`,
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
        desc: describeAssignment(textReg(rd), `[${textAddi(textReg(rs1), immis)}]`),
        eval: () => {
          const a = getReg(rs1);
          setReg(rd, getMem(a + immis));
        }
      };
    case 0b0100011: // sw
      if (funct3 != 0b010) {
        return null;
      }
      return {
        op: `sw x${rs1}, ${immss}, x${rs2}`,
        desc: `[${textAddi(textReg(rs1), immss)}] := x${rs2}`,
        eval: () => {
          const a = getReg(rs1);
          const b = getReg(rs2);
          setMem(a + immss, b);
        }
      };
    case 0b0010011: // addi, slti, sltiu, xori, ori, andi, slli, srli, srai
      switch (funct3) {
        case 0b000: op = 'add'; opdesc = '+'; break;
        // case 0b010: op = 'slt'; opdesc = '<'; break;
        case 0b100: op = 'xor'; opdesc = 'xor'; break;
      }
      return {
        op: `${op}i x${rd}, x${rs1}, ${immis}`,
        desc: describeAssignment(textReg(rd), textRegImm(rs1, immis, opdesc)),
        eval: () => {
          const a = getReg(rs1);
          setReg(rd, arithmetics[op](a, immis));
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
        case 0b0000010_010: op = 'sge'; opdesc = '>='; break;
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
        desc: describeAssignment(textReg(rd), textRegReg(rs1, rs2, opdesc)),
        eval: () => {
          const a = getReg(rs1);
          const b = getReg(rs2);
          setReg(rd, arithmetics[op](a, b));
        }
      };
    case 0b1110011: // ebreak, eread, ewrite
      switch ((code >> 20) & 7) {
        case 1: // ebreak
          return {
            op: 'ebreak',
            desc: 'HALT',
            eval: () => {
              state.isHalted = true;
            }
          };
        case 2: // eread
          return {
            op: 'eread ' + textReg(rd),
            desc: 'READ ' + textReg(rd),
            eval: () => {
              const input = programInput.value;
              if (state.readPos >= input.length) {
                setReg(rd, 0);
              } else {
                setReg(rd, input.charCodeAt(state.readPos++));
              }
            }
          };
        case 4: // ewrite
        case 'ewrite':
          return {
            op: 'ewrite ' + textReg(rs1),
            desc: 'WRITE ' + textReg(rs1),
            eval: () => { programOutput.value += String.fromCharCode(getReg(rs1)); }
          };
      }
      break;
  }
  return null;
}

function reloadProgram() {
  state.programCounter = 0;
  state.registers = new Int32Array(REGISTER_COUNT);
  for (let i = 0; i < REGISTER_COUNT; ++i) {
    setReg(i, 0);
  }
  for (let i = 0; i < MEMORY_SIZE; ++i) {
    setMem(i, 0);
  }
  state.readPos = 0;
  state.isHalted = true;

  const labels = {};
  const labelJumps = [];
  const labelBranches = [];
  const errors = [];
  const program = [];
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

      if (type === 'empty') {
        matchedOnce = true;
        break;
      }

      if (type === 'label') {
        matchedOnce = true;
        labels[match[1]] = program.length;
        break;
      }

      if (type === 'data') {
        matchedOnce = true;
        const val = +match[1];
        const n = +match[2];
        for (let i = 0; i < n; ++i) {
          program.push(['data', [val]]);
        }
        break;
      }

      const op = match[1];
      if (variant.ops.indexOf(op) === -1) {
        // errors.push(`Unknown operator ${op} of type '${type}' at line ${lineId}`);
        continue;
      }

      matchedOnce = true;

      const func = variant.ops[op];
      switch (type) {
        case 'R': program.push([match[1], [+match[2], +match[3], +match[4]]]); break;
        case 'I': program.push([match[1], [+match[2], +match[3], +match[4]]]); break;
        case 'S': program.push([match[1], [+match[2], +match[3], +match[4]]]); break;
        case 'U':
          if (match[1] === 'li') {
            const imm = +match[3];
            if (-2048 <= imm && imm < 2048) {
              program.push(['addi', [+match[2], 0, imm]]);
            } else {
              const low = imm & 0xFFF;
              const lows = signExtend(low, 12);
              const high = ((imm - lows) >> 12) & 0xFFFFF;
              program.push(['lui', [+match[2], high]]);
              if (lows != 0) {
                program.push(['addi', [+match[2], +match[2], lows]]);
              }
            }
          } else {
            program.push([match[1], [+match[2], +match[3]]]);
          }
          break;
        case 'BLabel':
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
          break;
        case 'ULabel':
          labelJumps.push({
            pos: program.length,
            lineId,
            func,
            op: match[1],
            rd: match[2],
            label: match[3]
          });
          if (match[1] === 'li') {
            program.push({});
          }
          program.push({});
          break;
        case 'noArg': program.push([match[1], []]); break;
        case 'env1': program.push([match[1], [+match[2]]]); break;
      }
    }

    if (!matchedOnce) {
      errors.push(`Unknown operator format: '${line.trim()}' at line ${lineId}`);
    }
  }

  for (const lj of labelJumps) {
    if (labels[lj.label] === undefined) {
      errors.push(`Unknown label '${lj.label}' at line ${lj.lineId}`);
      continue;
    }
    if (lj.op === 'li') {
      const imm = labels[lj.label];
      program[lj.pos + 0] = ['lui', [lj.rd, (imm >> 12) & 0xFFFFF]];
      program[lj.pos + 1] = ['addi', [lj.rd, lj.rd, imm & 0xFFF]];
    } else {
      const diff = labels[lj.label] - lj.pos - 1;
      program[lj.pos] = [lj.op, [lj.rd, diff]];
    }
  }

  for (const lb of labelBranches) {
    if (labels[lb.label] === undefined) {
      errors.push(`Unknown label '${lb.label}' at line ${lb.lineId}`);
      continue;
    }
    const diff = labels[lb.label] - lb.pos - 1;
    program[lb.pos] = [lb.op, [lb.rs1, lb.rs2, diff]];
  }

  if (errors.length === 0) {
    for (const pos in program) {
      setMem(pos, encodeCommand(program[pos][0], program[pos][1]));
    }
    memoryTable.style.display = '';
    errorList.style.display = 'none';
  } else {
    errorList.innerText = errors.join('\n');
    memoryTable.style.display = 'none';
    errorList.style.display = '';
  }

  updateMemoryTable();
  updateRegisters();
}

function stepOnce() {
  const cmd = state.commands[state.programCounter++];
  if (cmd) {
    cmd.eval();
  } else {
    state.isHalted = true;
  }
  updateMemoryTable();
  updateRegisters();
}

let programTimer = null;

function stepIfNotHalted() {
  if (!state.isHalted) {
    stepOnce();
  } else {
    clearInterval(programTimer);
    programTimer = null;
  }
}

function runProgram() {
  if (programTimer !== null) {
    clearInterval(programTimer);
  }
  state.isHalted = false;
  programTimer = setInterval(stepIfNotHalted, 0);
}

function stopProgram() {
  state.isHalted = true;
}

function reloadAndRun() {
  reloadProgram();
  runProgram();
}

window.onload = () => {
  sourceCode = document.getElementById('code');
  memoryTable = document.getElementById('memoryTable');
  memoryTableBody = document.getElementById('memoryTableBody');
  errorList = document.getElementById('errorList');
  programInput = document.getElementById('programInput');
  programOutput = document.getElementById('programOutput');

  errorList.style.display = 'none';

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

  for (let i = 0; i < REGISTER_COUNT / 4; ++i) {
    tr = document.createElement('tr');

    for (let j = 0; j < 4; ++j) {
      td = document.createElement('td');
      td.innerText = `x${i + (REGISTER_COUNT / 4) * j}`;
      tr.appendChild(td);
      td = document.createElement('td');
      td.innerText = '0';
      tr.appendChild(td);
      registersTable[`x${i + (REGISTER_COUNT / 4) * j}`] = td;
    }

    table.appendChild(tr);
  }

  registersPlaceholder.appendChild(table);

  for (let i = 0; i < MEMORY_PAGE_SIZE; ++i) {
    const row = {
      tr: document.createElement('tr'),
      address: document.createElement('td'),
      hex: document.createElement('td'),
      decimal: document.createElement('td'),
      command: document.createElement('td'),
      explanation: document.createElement('td'),
    };
    row.tr.appendChild(row.address);
    row.tr.appendChild(row.hex);
    row.tr.appendChild(row.decimal);
    row.tr.appendChild(row.command);
    row.tr.appendChild(row.explanation);
    memoryTableBody.appendChild(row.tr);
    tablePage.push(row);
  }

  reloadProgram();
  updateMemoryTable();
}

window.onunload = () => {
  localStorage.setItem('savedSource', sourceCode.value);
}

function clampMem(addr) {
  return Math.max(0, Math.min(addr, MEMORY_SIZE - MEMORY_PAGE_SIZE));
}

function firstPage() {
  tableShift = clampMem(0);
  updateMemoryTable();
}

function previousPage() {
  tableShift = clampMem(tableShift - MEMORY_PAGE_SIZE);
  updateMemoryTable();
}

function nextPage() {
  tableShift = clampMem(tableShift + MEMORY_PAGE_SIZE);
  updateMemoryTable();
}

function lastPage() {
  tableShift = clampMem(MEMORY_SIZE);
  updateMemoryTable();
}
