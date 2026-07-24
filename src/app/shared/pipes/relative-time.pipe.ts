import { Pipe, PipeTransform } from '@angular/core';
import { formatRelativeTime } from '../../core/utils/relative-time.util';

@Pipe({ name: 'relativeTime' })
export class RelativeTimePipe implements PipeTransform {
  transform(value: Date): string {
    return formatRelativeTime(value);
  }
}
