# tiny-stack-vm-01

A tiny stack VM for make.fun's "Build a tiny stack virtual machine"
bounty. `main.ts` (Node 22, stdlib only) runs all 40 instances of a set
and writes each answer as `/output/<id>/stdout.bin` + `exit.txt`.

## Design

Table-driven interpreter of the kit ISA: a packed per-opcode table
drives fetch/decode, a two-operand branch handles arithmetic/logic, a
switch the rest. Three typed arrays (256 stack, 64 call depth, 256
memory). Every hard rule honoured: wrapping `MUL`, `INT_MIN / -1`,
unsigned `DIVU`/`MODU`/`LTU`, shifts masked to 5 bits, `PUSH8` sign
extension, all ten traps with their own exit codes. Deterministic.

## Practice (kit set, 40 instances)

Score **1,000,000 / 1,000,000** (40/40 answered). House baseline
plain-vm 1.0.0: 670,000. Differential-tested vs the kit reference VM
(400 random programs, 35 edge cases): all match. Runs in ~0.3 s.

## License

MIT — see `LICENSE`.
