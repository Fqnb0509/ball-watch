import type { Match, Sport } from './types'

const when = (offset: number, hour: number, minute = 0) => {
  const value = new Date()
  value.setDate(value.getDate() + offset)
  value.setHours(hour, minute, 0, 0)
  return value.toISOString()
}
const team = (id: string, name: string, shortName: string, players: string[] = []) => ({ id, name, shortName, players })

export const matches: Match[] = [
  { id: 'ucl', sport: 'football', league: 'UEFA Champions League', round: '半决赛 · 次回合', homeTeam: team('arsenal', '阿森纳', 'ARS'), awayTeam: team('psg', '巴黎圣日耳曼', 'PSG'), startTime: when(0, 3), date: when(0, 3), status: 'live', score: [1, 1], venue: '酋长球场', logo: '', description: '欧冠半决赛次回合', streamIds: ['ucl-main', 'ucl-backup'] },
  { id: 'nba', sport: 'basketball', league: 'NBA', round: '东部半决赛 · G3', homeTeam: team('celtics', '波士顿凯尔特人', 'BOS'), awayTeam: team('knicks', '纽约尼克斯', 'NYK'), startTime: when(0, 8, 30), date: when(0, 8, 30), status: 'upcoming', venue: 'TD 花园', logo: '', streamIds: ['nba-main', 'nba-backup'] },
  { id: 'atp', sport: 'tennis', league: 'ATP 1000 Madrid', round: '男单 · 决赛', homeTeam: team('sinner', '扬尼克·辛纳', 'SIN', ['Jannik Sinner']), awayTeam: team('alcaraz', '卡洛斯·阿尔卡拉斯', 'ALC', ['Carlos Alcaraz']), startTime: when(0, 21), date: when(0, 21), status: 'upcoming', venue: 'Caja Mágica', logo: '', streamIds: ['atp-main'] },
  { id: 'laliga', sport: 'football', league: 'LaLiga', round: '第 35 轮', homeTeam: team('barcelona', '巴塞罗那', 'FCB'), awayTeam: team('madrid', '皇家马德里', 'RMA'), startTime: when(1, 3), date: when(1, 3), status: 'upcoming', venue: 'Spotify 诺坎普', logo: '', streamIds: ['laliga-main', 'laliga-backup'] },
  { id: 'cba', sport: 'basketball', league: 'CBA', round: '总决赛 · G2', homeTeam: team('guangdong', '广东宏远', 'GDE'), awayTeam: team('liaoning', '辽宁本钢', 'LIO'), startTime: when(2, 19, 35), date: when(2, 19, 35), status: 'upcoming', venue: '东莞篮球中心', logo: '', streamIds: ['cba-main', 'cba-backup'] },
  { id: 'wnba', sport: 'basketball', league: 'WNBA', round: '常规赛', homeTeam: team('liberty', '纽约自由人', 'NYL'), awayTeam: team('aces', '拉斯维加斯王牌', 'LVA'), startTime: when(-1, 10), date: when(-1, 10), status: 'finished', score: [89, 84], venue: '巴克莱中心', logo: '', streamIds: [] },
]

export const sportLabels: Record<Sport | 'all', string> = { all: '全部', football: '足球', basketball: '篮球', tennis: '网球', esports: '电竞' }
export const sportIcons: Record<Sport | 'all', string> = { all: '◈', football: '⬡', basketball: '◉', tennis: '◌', esports: '✦' }
export const getMatch = (id: string) => matches.find((match) => match.id === id)
