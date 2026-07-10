import { describe, expect, it } from 'vitest';
import { parseTleBlock, tleToOmm } from './tle-to-omm.js';

describe('TLE to OMM utilities', () => {
  const AMSAT_daily_bulletin = `
SB KEPS @ AMSAT  $ORB26155.1
2Line Orbital Elements 26155.AMSAT

QST de W1STR

AMSAT Orbital Elements for Amateur Satellites in TLE Format
From Orbital Analysis Office
New England Sci-Tech STEM Education Center
Natick MA June 04, 2026
To all radio amateurs


These element sets describe the orbits of various satellites 
in use by the amateur radio community. For details see:
www.amsat.org/keplerian-elements-formats/

A daily update of element sets is available at: www.amsat.org/tle/daily-bulletin.txt
or without bulletin text: www.amsat.org/tle/dailytle.txt

AO-07
1 07530U 74089B   26154.66963161 -.00000047  00000-0 -29295-5 0  9994
2 07530 101.9902 167.7751 0012419 155.3130 322.4092 12.53697881358826
GO-32
1 25397U 98043D   26154.57772251  .00000069  00000-0  49972-4 0  9994
2 25397  99.0064 146.9934 0000319 213.6137 146.5021 14.24425649449397
ISS
1 25544U 98067A   26154.96745432  .00008451  00000-0  15807-3 0  9990
2 25544  51.6330   5.5404 0007082 130.0270 230.1341 15.49590346569705
NO-44
1 26931U 01043C   26154.60928777  .00000163  00000-0  91734-4 0  9991
2 26931  67.0512 279.3895 0006115 263.9670  96.0735 14.31950876288500

this is a trimmed version of the original

/EX`;

  const broken_3LE = `
AO-07
1 07530U 74089B   26154.66963161 -.00000047  00000-0 -29295-5 0  9994
2 07530 101.9902 167.7751 0012419 155.3130 322.4092 12.53697881358826
UO-11
GARBAGE

2 14781  97.8051 120.8543 0006504 218.7082 141.3671 14.90749915255182
AO-27
1 22825U 93061C   26154.64439705  .00000131  00000-0  66973-4 0  9994
2 22825  98.6883 222.0623 0009234 135.0556 225.1375 14.30938483705069
`;

  // TLE sample with no name line
  const TLE_SAMPLE = `
1 07530U 74089B   26154.66963161 -.00000047  00000-0 -29295-5 0  9994
2 07530 101.9902 167.7751 0012419 155.3130 322.4092 12.53697881358826
1 22825U 93061C   26154.64439705  .00000131  00000-0  66973-4 0  9994
2 22825  98.6883 222.0623 0009234 135.0556 225.1375 14.30938483705069
`;

  it('should parse sample 3LE text and extract satellite data', () => {
    const satelliteData = parseTleBlock(AMSAT_daily_bulletin);
    expect(satelliteData).toBeInstanceOf(Array);
    expect(satelliteData.length).toBeGreaterThan(0);

    // expect one of the entries to be the ISS (NORAD_CAT_ID: 25544)
    expect(satelliteData.some((item) => item.NORAD_CAT_ID === 25544 && item.OBJECT_NAME === 'ISS')).toBe(true);
  });

  it('should gracefully extract data from corrupt 3LE block', () => {
    const satelliteData = parseTleBlock(broken_3LE);
    expect(satelliteData).toBeInstanceOf(Array);
    expect(satelliteData.length).toEqual(2); // Only AO-07 and AO-27 should be parsed, UO-11 is corrupted
    expect(satelliteData.some((item) => item.OBJECT_NAME === 'AO-07')).toBe(true);
    expect(satelliteData.some((item) => item.OBJECT_NAME === 'AO-27')).toBe(true);
  });

  it('should gracefully extract data from TLE block that has no name lines', () => {
    const satelliteData = parseTleBlock(TLE_SAMPLE);
    expect(satelliteData).toBeInstanceOf(Array);
    expect(satelliteData.length).toEqual(2);
    expect(satelliteData.some((item) => item.NORAD_CAT_ID === 7530)).toBe(true);
    expect(satelliteData.some((item) => item.NORAD_CAT_ID === 22825)).toBe(true);
  });
});
