import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
  untracked,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Placeholder } from '@features/notes/model/note.model';
import { CopyButtonComponent } from '../copy-button/copy-button.component';
import {
  PlaceholderFieldsComponent,
  PlaceholderValue,
} from '../placeholder-fields/placeholder-fields.component';

/** Combien de valeurs la barre repliée nomme avant de compter le reste. */
const SUMMARY_LIMIT = 2;

/** Les valeurs telles que la note les porte : le point de départ de la saisie. */
function storedValues(placeholders: readonly Placeholder[]): Record<string, string> {
  return Object.fromEntries(placeholders.map((placeholder) => [placeholder.name, placeholder.value]));
}

function sameValues(a: Record<string, string>, b: Record<string, string>): boolean {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].every((name) => (a[name] ?? '') === (b[name] ?? ''));
}

/**
 * Les `{{champs}}` de la note ouverte, à remplir sur place.
 *
 * Déplié, il est le formulaire ; replié, il tient sur une ligne qui **résume ce
 * qu'il cache** — `host = db.internal`, et le compte du reste. Un résumé se lit
 * comme quelque chose à ouvrir, là où un compteur seul se lisait comme un titre
 * de section, ce dont personne ne pense à cliquer. Toute la bande est le bouton,
 * et elle nomme son geste (« Afficher ») : trois indices plutôt qu'un chevron.
 *
 * Rien ne s'affiche pour une note qui n'a pas de champ — l'éditeur ne le monte
 * pas —, parce qu'un en-tête toujours présent et toujours vide serait une case à
 * cocher que personne ne coche.
 *
 * Il tient un **brouillon local** des valeurs, comme le corps et le titre :
 * confirmé à la sortie du champ, pas à chaque frappe, faute de quoi il y aurait
 * une écriture en base par caractère. Le brouillon est réamorcé sur l'**id** de
 * la note, jamais sur la note : chaque enregistrement en produit un nouvel objet
 * et écraserait la saisie en cours.
 *
 * Ne mute rien et ne remplit rien : il émet, `NotesStore` persiste et le back
 * substitue.
 */
@Component({
  selector: 'app-placeholder-panel',
  imports: [CopyButtonComponent, PlaceholderFieldsComponent, TranslocoPipe],
  templateUrl: './placeholder-panel.component.html',
  styleUrl: './placeholder-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderPanelComponent {
  readonly placeholders = input.required<readonly Placeholder[]>();

  /** Source du brouillon : voir l'avertissement en tête de classe. */
  readonly noteId = input.required<string>();

  /** Préférence d'affichage, tenue par l'éditeur : elle survit à la note. */
  readonly open = input(true);

  /** L'aperçu appartient à l'éditeur — c'est son corps qu'il remplace. */
  readonly previewing = input(false);

  /** Texte de la note tel quel, pour la copie sans remplissage. */
  readonly rawContent = input('');

  readonly toggled = output<void>();
  readonly previewToggled = output<void>();
  /** À chaque frappe : ce que l'aperçu suit. N'écrit rien. */
  readonly valuesChanged = output<Record<string, string>>();
  /** À la sortie du champ : ce que la note enregistre. */
  readonly valuesCommitted = output<Record<string, string>>();

  private readonly draft = linkedSignal({
    source: this.noteId,
    computation: () => untracked(() => storedValues(this.placeholders())),
  });

  /** Ce que le panneau affiche à l'instant — l'éditeur remplit avec. */
  readonly values = this.draft.asReadonly();

  /**
   * Ce qui est réputé enregistré. Comparé au brouillon plutôt qu'aux valeurs
   * reçues : entre la confirmation et le retour du back, la note ouverte porte
   * encore les anciennes, et chaque passage d'un champ à l'autre réécrirait.
   */
  private readonly committed = linkedSignal({
    source: this.noteId,
    computation: () => untracked(() => storedValues(this.placeholders())),
  });

  protected readonly total = computed(() => this.placeholders().length);
  protected readonly filled = computed(
    () => this.placeholders().filter((placeholder) => this.draft()[placeholder.name]).length,
  );

  /**
   * Ce que la barre repliée montre de son contenu. Un résumé se lit comme
   * quelque chose à ouvrir, là où un compteur seul se lit comme une étiquette —
   * et il répond sans clic à « avec quoi je vais copier ? ».
   */
  private readonly summary = computed(() =>
    this.placeholders()
      .map((placeholder) => ({ name: placeholder.name, value: this.draft()[placeholder.name] ?? '' }))
      .filter((entry) => entry.value !== ''),
  );

  /** Deux suffisent : au-delà, la barre déborderait au lieu de renseigner. */
  protected readonly visibleSummary = computed(() => this.summary().slice(0, SUMMARY_LIMIT));
  protected readonly hiddenSummary = computed(() => Math.max(0, this.summary().length - SUMMARY_LIMIT));

  protected onChanged({ name, value }: PlaceholderValue): void {
    this.draft.update((current) => ({ ...current, [name]: value }));
    this.valuesChanged.emit(this.draft());
  }

  /**
   * Vide tous les champs : les valeurs par défaut du texte reprennent la main.
   * Confirmé tout de suite — c'est un geste, pas une frappe.
   */
  protected reset(): void {
    this.draft.set({});
    this.valuesChanged.emit(this.draft());
    this.commit();
  }

  /**
   * Confirme la saisie. Appelé à la sortie d'un champ **et** par l'éditeur avant
   * de se fermer : ni Échap, ni le fond, ni la croix ne produisent de `blur`.
   *
   * N'envoie que les champs que le texte porte aujourd'hui : une valeur dont le
   * jeton a disparu du contenu n'a plus de case où s'afficher, et la garder
   * ferait grossir la base d'un remplissage que personne ne peut plus voir.
   */
  commit(): void {
    const values = Object.fromEntries(
      this.placeholders().map((placeholder) => [placeholder.name, this.draft()[placeholder.name] ?? '']),
    );

    if (sameValues(values, this.committed())) return;

    this.committed.set(values);
    this.valuesCommitted.emit(values);
  }
}
