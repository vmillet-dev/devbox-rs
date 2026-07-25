import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '../../../../../testing/provide-transloco-testing';
import { SearchBoxComponent } from './search-box.component';

describe('SearchBoxComponent', () => {
  let fixture: ComponentFixture<SearchBoxComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SearchBoxComponent], providers: [provideTranslocoTesting()] });
    fixture = TestBed.createComponent(SearchBoxComponent);
    fixture.autoDetectChanges();
  });

  it('renders the provided query in the input', async () => {
    fixture.componentRef.setInput('query', 'hello');
    await fixture.whenStable();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    expect(input.value).toBe('hello');
  });

  it('emits queryChange with the new value when the user types', () => {
    let emitted: string | undefined;
    fixture.componentInstance.queryChange.subscribe((value) => (emitted = value));

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    input.value = 'search term';
    input.dispatchEvent(new Event('input'));

    expect(emitted).toBe('search term');
  });

  it('focuses the native input when focus() is called', () => {
    // The element must be attached to the document for jsdom to update `document.activeElement`.
    document.body.appendChild(fixture.nativeElement);

    fixture.componentInstance.focus();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    expect(document.activeElement).toBe(input);

    fixture.nativeElement.remove();
  });
});
