// Tiny stack VM for make.fun's tiny-stack-vm-01 bounty. Runs every
// /input/<id>/program.bin on its input.bin, writes /output/<id>/stdout.bin
// + exit.txt. Node 22, stdlib only. Full ISA: 32-bit wrapping ints, 256
// stack, 64 call depth, 256 memory words, ten traps with their own codes,
// 1M-step and 64K-output limits, every edge case honoured (wrapping MUL,
// INT_MIN/-1, unsigned ops, shifts masked to 5 bits, PUSH8 sign extension).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Per-opcode [immediate bytes, values popped, values pushed], packed as
// "hex,imm pops pushes" triples; a byte with no triple is not an opcode.
const SPEC = {};
for (const t of '00,000 01,101 02,401 03,010 04,012 05,022 06,023 07,033 10,021 11,021 12,021 13,021 14,021 15,021 16,021 17,011 18,021 19,021 1a,021 1b,011 1c,021 1d,021 1e,021 20,021 21,021 22,021 30,200 31,210 32,210 33,200 34,000 40,011 41,020 50,010 51,010 52,001 53,010'.split(' ')) {
  const [o, v] = t.split(',');
  SPEC[parseInt(o, 16)] = [+v[0], +v[1], +v[2]];
}

// Runs one program on its input bytes; returns [output bytes, exit code].
function run(p, inp) {
  const n = p.length;
  const S = new Int32Array(256); // data stack
  const R = new Int32Array(64); // return addresses
  const M = new Int32Array(256); // memory, all zero
  const o = []; // output bytes
  let sp = 0, rp = 0, pc = 0, ip = 0, steps = 0, code = -1;
  while (code < 0) {
    if (steps === 1000000) { code = 10; break; } // step limit
    if (pc < 0 || pc >= n) { code = 9; break; } // pc outside program
    const op = p[pc];
    const s = SPEC[op];
    if (s === undefined) { code = 5; break; } // unknown opcode
    if (pc + s[0] >= n) { code = 9; break; } // immediate cut off
    steps++;
    if (sp < s[1]) { code = 2; break; } // stack underflow
    if (sp - s[1] + s[2] > 256) { code = 3; break; } // stack overflow
    pc = pc + 1 + s[0]; // pc now points past the instruction
    if (op >= 0x10 && op <= 0x22 && op !== 0x17 && op !== 0x1b) {
      const b = S[sp - 1], a = S[sp - 2];
      let r = 0;
      if (op === 0x10) r = (a + b) | 0; // ADD wraps
      else if (op === 0x11) r = (a - b) | 0; // SUB wraps
      else if (op === 0x12) r = Math.imul(a, b); // MUL, low 32 bits exact
      else if (op === 0x13) { // DIV, truncated toward zero
        if (b === 0) code = 4;
        else r = (a === -2147483648 && b === -1) ? a : (a / b) | 0;
      } else if (op === 0x14) { // MOD, sign of the dividend
        if (b === 0) code = 4;
        else r = b === -1 ? 0 : (a % b) | 0;
      } else if (op === 0x15) { // DIVU
        if (b === 0) code = 4;
        else r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
      } else if (op === 0x16) { // MODU
        if (b === 0) code = 4;
        else r = ((a >>> 0) % (b >>> 0)) | 0;
      } else if (op === 0x18) r = a & b;
      else if (op === 0x19) r = a | b;
      else if (op === 0x1a) r = a ^ b;
      else if (op === 0x1c) r = a << (b & 31); // SHL
      else if (op === 0x1d) r = a >> (b & 31); // SHR, arithmetic
      else if (op === 0x1e) r = (a >>> (b & 31)) | 0; // SHRU, logical
      else if (op === 0x20) r = a === b ? 1 : 0; // EQ
      else if (op === 0x21) r = a < b ? 1 : 0; // LT, signed
      else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // 0x22 LTU
      if (code < 0) { sp -= 2; S[sp++] = r; }
    } else switch (op) {
      case 0x00: code = 0; break; // HALT
      case 0x01: S[sp++] = (p[pc - 1] << 24) >> 24; break; // PUSH8, sign-extended
      case 0x02: // PUSH32, little-endian signed
        S[sp++] = p[pc - 4] | (p[pc - 3] << 8) | (p[pc - 2] << 16) | (p[pc - 1] << 24);
        break;
      case 0x03: sp--; break; // POP
      case 0x04: S[sp] = S[sp - 1]; sp++; break; // DUP
      case 0x05: { const t = S[sp - 1]; S[sp - 1] = S[sp - 2]; S[sp - 2] = t; break; } // SWAP
      case 0x06: S[sp] = S[sp - 2]; sp++; break; // OVER
      case 0x07: { // ROT
        const t = S[sp - 3]; S[sp - 3] = S[sp - 2]; S[sp - 2] = S[sp - 1]; S[sp - 1] = t;
        break;
      }
      case 0x17: S[sp - 1] = (-S[sp - 1]) | 0; break; // NEG wraps
      case 0x1b: S[sp - 1] = ~S[sp - 1]; break; // NOT
      case 0x30: case 0x31: case 0x32: { // JMP / JZ / JNZ
        const rel = ((p[pc - 2] | (p[pc - 1] << 8)) << 16) >> 16;
        if (op === 0x30 || (op === 0x31) === (S[--sp] === 0)) pc += rel;
        break;
      }
      case 0x33: // CALL
        if (rp === 64) { code = 7; break; }
        R[rp++] = pc;
        pc = p[pc - 2] | (p[pc - 1] << 8);
        break;
      case 0x34: // RET
        if (rp === 0) { code = 8; break; }
        pc = R[--rp];
        break;
      case 0x40: { // LOAD
        const addr = S[sp - 1];
        if (addr < 0 || addr > 255) { code = 6; break; }
        S[sp - 1] = M[addr];
        break;
      }
      case 0x41: { // STORE: (v addr --)
        const addr = S[sp - 1];
        if (addr < 0 || addr > 255) { code = 6; break; }
        M[addr] = S[sp - 2];
        sp -= 2;
        break;
      }
      case 0x50: { // PRINT
        const s = String(S[sp - 1]);
        if (o.length + s.length > 65536) { code = 11; break; }
        sp--;
        for (let i = 0; i < s.length; i++) o.push(s.charCodeAt(i));
        break;
      }
      case 0x51: // PUTC: one byte
        if (o.length + 1 > 65536) { code = 11; break; }
        o.push(S[--sp] & 255);
        break;
      case 0x52: S[sp++] = ip < inp.length ? inp[ip++] : -1; break; // IN, -1 at EOF
      case 0x53: code = S[--sp] & 255; break; // EXIT, low byte
    }
  }
  return [Uint8Array.from(o), code];
}

const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(IN).sort()) {
  const prog = new Uint8Array(readFileSync(join(IN, id, 'program.bin')));
  const inp = new Uint8Array(readFileSync(join(IN, id, 'input.bin')));
  const [bytes, code] = run(prog, inp);
  mkdirSync(join(OUT, id), { recursive: true });
  writeFileSync(join(OUT, id, 'stdout.bin'), bytes);
  writeFileSync(join(OUT, id, 'exit.txt'), String(code) + '\n');
}
