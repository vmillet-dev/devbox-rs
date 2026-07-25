import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { CodeViewerComponent } from './code-viewer.component';

describe('CodeViewerComponent', () => {
  let fixture: ComponentFixture<CodeViewerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CodeViewerComponent] });
    fixture = TestBed.createComponent(CodeViewerComponent);
    fixture.componentRef.setInput('content', '');
    fixture.autoDetectChanges();
  });

  it('renders one line number per content line', async () => {
    fixture.componentRef.setInput('content', 'line one\nline two\nline three');
    await fixture.whenStable();

    const lineNumbers = fixture.debugElement.queryAll(By.css('.line-no'));
    expect(lineNumbers.map((el) => el.nativeElement.textContent)).toEqual(['1', '2', '3']);
  });

  it('renders plain text lines as a single plain token by default', async () => {
    fixture.componentRef.setInput('content', 'const x = 1;');
    await fixture.whenStable();

    const tokens = fixture.debugElement.queryAll(By.css('.line-content span'));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].classes['tok-plain']).toBe(true);
    expect(tokens[0].nativeElement.textContent).toBe('const x = 1;');
  });

  it('tokenizes JSON keys, strings, numbers and punctuation', async () => {
    fixture.componentRef.setInput('content', '{"name": "value", "count": 2}');
    fixture.componentRef.setInput('language', 'json');
    await fixture.whenStable();

    const tokens = fixture.debugElement.queryAll(By.css('.line-content span'));
    const tokenTexts = tokens.map((token) => token.nativeElement.textContent);
    const tokenClasses = tokens.map((token) => Object.keys(token.classes).find((cls) => cls.startsWith('tok-')));

    expect(tokenTexts).toEqual([
      '{',
      '"name"',
      ':',
      ' ',
      '"value"',
      ',',
      ' ',
      '"count"',
      ':',
      ' ',
      '2',
      '}',
    ]);
    expect(tokenClasses).toEqual([
      'tok-punct',
      'tok-key',
      'tok-punct',
      'tok-plain',
      'tok-string',
      'tok-punct',
      'tok-plain',
      'tok-key',
      'tok-punct',
      'tok-plain',
      'tok-number',
      'tok-punct',
    ]);
  });

  it('keeps trailing plain text after the last JSON token', async () => {
    fixture.componentRef.setInput('content', '{"a": 1} trailing');
    fixture.componentRef.setInput('language', 'json');
    await fixture.whenStable();

    const tokens = fixture.debugElement.queryAll(By.css('.line-content span'));
    const last = tokens[tokens.length - 1];
    expect(last.nativeElement.textContent).toBe(' trailing');
    expect(last.classes['tok-plain']).toBe(true);
  });

  it('keeps a full comment line as a single comment token, even for JSON', async () => {
    fixture.componentRef.setInput('content', '  // a comment');
    fixture.componentRef.setInput('language', 'json');
    await fixture.whenStable();

    const tokens = fixture.debugElement.queryAll(By.css('.line-content span'));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].classes['tok-comment']).toBe(true);
    expect(tokens[0].nativeElement.textContent).toBe('  // a comment');
  });
});
