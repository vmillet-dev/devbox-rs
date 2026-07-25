import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { Space } from '../../../../core/models/space.model';
import { SpaceSwitcherComponent } from './space-switcher.component';

const SPACES: Space[] = [
  { id: 'work', name: 'Work' },
  { id: 'personal', name: 'Personal' },
];

describe('SpaceSwitcherComponent', () => {
  let fixture: ComponentFixture<SpaceSwitcherComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SpaceSwitcherComponent] });
    fixture = TestBed.createComponent(SpaceSwitcherComponent);
    fixture.componentRef.setInput('spaces', SPACES);
    fixture.componentRef.setInput('activeSpace', SPACES[0]);
    fixture.autoDetectChanges();
  });

  it('shows the active space name and keeps the dropdown closed by default', () => {
    expect(fixture.nativeElement.querySelector('.space-switch').textContent).toContain('Work');
    expect(fixture.debugElement.query(By.css('.space-dropdown'))).toBeNull();
  });

  it('opens the dropdown listing every space when toggled', async () => {
    fixture.debugElement.query(By.css('.space-switch')).triggerEventHandler('click');
    await fixture.whenStable();

    const options = fixture.debugElement.queryAll(By.css('.space-option'));
    expect(options.map((option) => option.nativeElement.textContent.trim())).toEqual(['Work', 'Personal']);
  });

  it('marks the active space option', async () => {
    fixture.debugElement.query(By.css('.space-switch')).triggerEventHandler('click');
    await fixture.whenStable();

    const options = fixture.debugElement.queryAll(By.css('.space-option'));
    expect(options[0].classes['active']).toBe(true);
    expect(options[1].classes['active']).toBeFalsy();
  });

  it('emits spaceChanged and closes the dropdown when a space is selected', async () => {
    let emitted: string | undefined;
    fixture.componentInstance.spaceChanged.subscribe((id) => (emitted = id));

    fixture.debugElement.query(By.css('.space-switch')).triggerEventHandler('click');
    await fixture.whenStable();
    fixture.debugElement.queryAll(By.css('.space-option'))[1].triggerEventHandler('click');
    await fixture.whenStable();

    expect(emitted).toBe('personal');
    expect(fixture.debugElement.query(By.css('.space-dropdown'))).toBeNull();
  });

  it('closes the dropdown when clicking outside the component', async () => {
    fixture.debugElement.query(By.css('.space-switch')).triggerEventHandler('click');
    await fixture.whenStable();
    expect(fixture.debugElement.query(By.css('.space-dropdown'))).not.toBeNull();

    const outsideClick = new MouseEvent('click');
    Object.defineProperty(outsideClick, 'target', { value: document.body });
    document.dispatchEvent(outsideClick);
    await fixture.whenStable();

    expect(fixture.debugElement.query(By.css('.space-dropdown'))).toBeNull();
  });

  it('does not close the dropdown when clicking inside the component', async () => {
    fixture.debugElement.query(By.css('.space-switch')).triggerEventHandler('click');
    await fixture.whenStable();

    const insideClick = new MouseEvent('click');
    Object.defineProperty(insideClick, 'target', { value: fixture.nativeElement.querySelector('.space-switch') });
    document.dispatchEvent(insideClick);
    await fixture.whenStable();

    expect(fixture.debugElement.query(By.css('.space-dropdown'))).not.toBeNull();
  });
});
