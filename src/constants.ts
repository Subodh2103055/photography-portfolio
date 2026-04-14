import { Photo, Category } from './types';

export const CATEGORIES: Category[] = [
  'Solitude & Journey',
  'Resilience & Beauty',
  'Urban Optimism',
  'Monsoon Reverie',
  'Whispering Green',
  'Fauna & Feathers',
  'Golden Hour & Silhouettes',
  'Nightscapes',
  'Concrete & Canopy',
  'Echoes of Faith',
  'Macro Details',
  'Vessels of Motion',
  'Human Tapestry',
  'Uncategorized'
];

export const PHOTOS: Photo[] = [
  {
    id: '1',
    title: 'Sunflower Under Blue Sky',
    categories: ['Resilience & Beauty', 'Urban Optimism'],
    imageUrl: 'https://picsum.photos/seed/sunflower/800/1000'
  },
  {
    id: '2',
    title: 'Crimson Bloom',
    categories: ['Resilience & Beauty'],
    imageUrl: 'https://picsum.photos/seed/hibiscus/800/1000'
  },
  {
    id: '3',
    title: 'The Lonely Path',
    categories: ['Solitude & Journey'],
    imageUrl: 'https://picsum.photos/seed/path/800/1000'
  },
  {
    id: '4',
    title: 'Rainy Window',
    categories: ['Monsoon Reverie'],
    imageUrl: 'https://picsum.photos/seed/rain/800/1000'
  },
  {
    id: '5',
    title: 'City Lights',
    categories: ['Urban Optimism'],
    imageUrl: 'https://picsum.photos/seed/city/800/1000'
  },
  {
    id: '6',
    title: 'Morning Mist',
    categories: ['Solitude & Journey', 'Monsoon Reverie'],
    imageUrl: 'https://picsum.photos/seed/mist/800/1000'
  },
  {
    id: '7',
    title: 'Abstract Frame',
    categories: ['Uncategorized'],
    imageUrl: 'https://picsum.photos/seed/abstract/800/1000'
  },
  {
    id: '8',
    title: 'Green Resilience',
    categories: ['Resilience & Beauty'],
    imageUrl: 'https://picsum.photos/seed/green/800/1000'
  }
];
