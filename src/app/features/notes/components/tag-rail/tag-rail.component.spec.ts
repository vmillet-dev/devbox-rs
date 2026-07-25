import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { TagPillComponent } from '@shared/ui/tag-pill/tag-pill.component';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { TagRailComponent } from './tag-rail.component';

describe('TagRailComponent', () => {
  let fixture: ComponentFixture<TagRailComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TagRailComponent], providers: [provideTranslocoTesting()] });
    fixture = TestBed.createComponent(TagRailComponent);
    fixture.componentRef.setInput('tags', []);
    fixture.componentRef.setInput('activeTags', new Set<string>());
    fixture.autoDetectChanges();
  });

  it('renders nothing when there are no tags', () => {
    expect(fixture.debugElement.query(By.css('.tag-rail'))).toBeNull();
  });

  it('renders a tag pill per tag, marking the active ones', async () => {
    fixture.componentRef.setInput('tags', ['alpha', 'beta']);
    fixture.componentRef.setInput('activeTags', new Set(['beta']));
    await fixture.whenStable();

    const pills = fixture.debugElement
      .queryAll(By.directive(TagPillComponent))
      .map((pill) => pill.componentInstance as TagPillComponent);

    expect(pills.map((pill) => pill.label())).toEqual(['alpha', 'beta']);
    expect(pills.map((pill) => pill.active())).toEqual([false, true]);
  });

  it('groups the pills under a single accessible name', async () => {
    fixture.componentRef.setInput('tags', ['alpha']);
    await fixture.whenStable();

    const rail = fixture.nativeElement.querySelector('.tag-rail');
    expect(rail.getAttribute('role')).toBe('group');
    expect(rail.getAttribute('aria-label')).toBe('Filtrer par tag');
  });

  it('forwards the toggled event from a tag pill as tagToggled', async () => {
    fixture.componentRef.setInput('tags', ['alpha']);
    await fixture.whenStable();
    let emitted: string | undefined;
    fixture.componentInstance.tagToggled.subscribe((tag) => (emitted = tag));

    const pill = fixture.debugElement.query(By.directive(TagPillComponent))
      .componentInstance as TagPillComponent;
    pill.toggled.emit('alpha');

    expect(emitted).toBe('alpha');
  });
});
