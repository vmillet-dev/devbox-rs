import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { TitlebarComponent } from './titlebar.component';

describe('TitlebarComponent', () => {
  let fixture: ComponentFixture<TitlebarComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TitlebarComponent] });
    fixture = TestBed.createComponent(TitlebarComponent);
    fixture.autoDetectChanges();
  });

  it('renders the default title when none is provided', () => {
    expect(fixture.nativeElement.querySelector('.titlebar-title').textContent.trim()).toBe('DevBox');
  });

  it('renders a custom title when provided', async () => {
    fixture.componentRef.setInput('title', 'Custom title');
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.titlebar-title').textContent.trim()).toBe('Custom title');
  });

  it('renders the three window-control dots', () => {
    expect(fixture.debugElement.queryAll(By.css('.dot'))).toHaveLength(3);
  });
});
