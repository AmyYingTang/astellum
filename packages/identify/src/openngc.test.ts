import { describe, it, expect } from 'vitest';
import { parseOpenNgc } from './openngc.js';

const HEADER =
  'Name;Type;RA;Dec;Const;MajAx;MinAx;PosAng;B-Mag;V-Mag;J-Mag;H-Mag;K-Mag;SurfBr;Hubble;Pax;Pm-RA;Pm-Dec;RadVel;Redshift;Cstar U-Mag;Cstar B-Mag;Cstar V-Mag;M;NGC;IC;Cstar Names;Identifiers;Common names;NED notes;OpenNGC notes;Sources';

const row = (name: string, type: string, ra: string, dec: string, maj = '', m = '', common = ''): string =>
  // 32 columns; fill the ones the parser reads, leave the rest blank.
  [name, type, ra, dec, 'Car', maj, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', m, '', '', '', '', common, '', '', ''].join(';');

describe('parseOpenNgc', () => {
  it('parses a sized NGC HII row (supplies the size SIMBAD omits)', () => {
    const c = parseOpenNgc([HEADER, row('NGC3576', 'HII', '11:11:31.67', '-61:21:46.8', '3.00')].join('\n'));
    expect(c).toHaveLength(1);
    expect(c[0]!.catalog_ids).toEqual({ ngc: 'NGC 3576' });
    expect(c[0]!.otype).toBe('HII');
    expect(c[0]!.size_arcmin).toEqual([3, 3]);
    expect(c[0]!.ra_deg).toBeCloseTo(167.8820, 3);
    expect(c[0]!.dec_deg).toBeCloseTo(-61.3630, 3);
    expect(c[0]!.source).toBe('OpenNGC');
  });

  it('reads the Messier number and the common name', () => {
    const c = parseOpenNgc([HEADER, row('NGC0224', 'G', '00:42:44.35', '+41:16:08.6', '199.53', '031', 'Andromeda Galaxy')].join('\n'));
    expect(c[0]!.catalog_ids).toMatchObject({ ngc: 'NGC 224', messier: 'M 31' });
    expect(c[0]!.common_name).toEqual({ en: 'Andromeda Galaxy' });
    expect(c[0]!.main_id).toBe('M 31');
  });

  it('strips leading zeros and handles IC + first of multiple common names', () => {
    const c = parseOpenNgc([HEADER, row('IC0434', 'EmN', '05:41:00.88', '-02:27:13.6', '', '', 'Flame Nebula,Orion B')].join('\n'));
    expect(c[0]!.catalog_ids).toEqual({ ic: 'IC 434' });
    expect(c[0]!.otype).toBe('EmO');
    expect(c[0]!.common_name).toEqual({ en: 'Flame Nebula' });
  });

  it('skips non-DSO rows (Dup / NonEx / Other) and unparseable names', () => {
    const lines = [
      HEADER,
      row('NGC3576', 'Dup', '11:11:31.67', '-61:21:46.8'),
      row('NGC0001', 'NonEx', '00:00:00.0', '+00:00:00.0'),
      row('MESSIER031', 'G', '00:42:44.35', '+41:16:08.6'),
    ];
    expect(parseOpenNgc(lines.join('\n'))).toHaveLength(0);
  });
});

// OpenNGC types a nebula with a cluster in it as Cl+N. It stays a nebula —
// M42 and the War and Peace Nebula are Cl+N — but says so, so the selector can
// keep a compact one (NGC 3603) its size alone would drop.
describe('a cluster with nebulosity', () => {
  it('stays an emission nebula and is marked as holding a cluster', () => {
    const c = parseOpenNgc([HEADER, row('NGC3603', 'Cl+N', '11:15:06.59', '-61:15:40.4', '3.30', '')].join('\n'));
    expect(c[0]!.otype).toBe('EmO');
    expect(c[0]!.with_cluster).toBe(true);
  });

  it('marks nothing else', () => {
    const c = parseOpenNgc([HEADER, row('IC0434', 'EmN', '05:41:00.88', '-02:27:13.6', '', '', 'Flame Nebula')].join('\n'));
    expect(c[0]!.with_cluster).toBeUndefined();
  });
});
