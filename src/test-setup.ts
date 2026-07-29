// TestBed initialisation, previously done by the Angular `unit-test` builder.
// No `zone.js` import: the app runs zoneless, and loading it here would hide a
// missing `provideZonelessChangeDetection()` behind a working test suite.
import { afterEach } from 'vitest';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

// The builder also reset the module between tests. Without it, the second
// `configureTestingModule` of a file hits an already-instantiated TestBed.
afterEach(() => getTestBed().resetTestingModule());
