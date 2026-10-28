import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hora12 } from '../src/util.ts';

describe('Hora en formato AM/PM', () => {
  it('HA1 pasa HH:MM a 12 horas, con medianoche y mediodía correctos, y no toca lo que no es una hora', () => {
    assert.deepEqual(['00:00', '00:05', '01:07', '09:30', '11:59', '12:00', '12:45', '13:00', '20:06', '23:59'].map(hora12),
      ['12:00 AM', '12:05 AM', '1:07 AM', '9:30 AM', '11:59 AM', '12:00 PM', '12:45 PM', '1:00 PM', '8:06 PM', '11:59 PM']);
    assert.deepEqual([hora12(''), hora12(null), hora12('—')], ['', '', '—']);
  });
});
