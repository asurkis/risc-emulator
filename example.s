  li x1, -12345678

  addi x10, x0, 10
  addi x11, x0, 1023
  addi x12, x1, 0
  addi x13, x0, 0
  addi x14, x11, 0
  bge  x12, x0, producer_loop
  addi x13, x0, 1
  sub x12, x0, x12

producer_loop:
  div x15, x12, x10
  rem x16, x12, x10
  addi x31, x16, 48
  sw x31, x14, 0
  addi x14, x14, -1
  addi x12, x15, 0
  bne x12, x0, producer_loop

  beq x13, x0, after_minus
  addi x31, x0, 45
  ewrite x31

after_minus:
  addi x14, x14, 1
  lw x31, x14, 0
  ewrite x31
  bne x14, x11, after_minus

  addi x31, x0, 10
  ewrite x31
  ebreak
