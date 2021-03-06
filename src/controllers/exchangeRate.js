import fs from 'fs'

import _ from 'lodash'

import {
	CurrencyRatesAsync
} from '../axios/axios_broker.js'

import {
	extractHeaderDate
} from '../utils/currency.js'

import {
	saveFileTo
} from '../utils/file.js'

import {
	fillLeftWithToken
} from '../utils/string.js'

import {
	lastMonthDay
} from '../utils/time.js'

import {
	median,
} from '../utils/math.js'

import {
	objectKeyFind,
	objectReduce
} from 'dot-quiver/utils/objects/objects.js'

import date from 'date-and-time'

export const onCurrencyRates = (base_currency, callback, date_str = 'latest') => {
	CurrencyRatesAsync(base_currency, callback, date_str)
}

export const onCurrencyRatesHistory = async (
		base_currency, to_currency, 
		from_date, to_date, 
		callback
	) => {
	
	let from_date_ = date.parse(from_date, 'YYYY-MM-DD');
	let to_date_ = date.parse(to_date, 'YYYY-MM-DD');
	
	let today_ = new Date()

	let today_from_diff = date.subtract(today_, from_date_).toDays()
	let today_to_diff = date.subtract(today_, to_date_).toDays()
	
	let day_diff = date.subtract(to_date_, from_date_).toDays()
	
	let curr_date = {}
	let curr_date_str = {}
	
	let currencies = {}
	
	let history = {}

	if(day_diff <= 0) {
		throw Error('Number of days between requests must be greater to zero !')
	}
	
	if(today_to_diff < 0 || today_from_diff < 0) {
		throw Error('The from- and to-dates must be before today !')
	}

	for (let day_incr = 0; day_incr <= day_diff; day_incr += 1) {
		curr_date = date.addDays(from_date_, day_incr);
		curr_date_str = date.format(curr_date, 'YYYY-MM-DD'),

		currencies = await CurrencyRatesAsync(
			base_currency, getCurrencyRatesCallback, curr_date_str
		)
		
		if(currencies !== undefined) {
			history[
				date.format(curr_date, 'YYYY-MM-DD')
			] = currencies['exchange_rates'][to_currency]
		}
	}

	return callback(
		{
			from_currency: base_currency,
			to_currency: to_currency,
			history: history
		}
	)
}

export const getCurrencyRatesHistory = (history) => history

export const onYearMonthCurrencyRatesHistory = async (
	base_currency, to_currency, 
	month, year, 
	callback
) => {

	const last_month_day = lastMonthDay(month-1, year)
	month = fillLeftWithToken(`${month}`, 2, '0');
	year = fillLeftWithToken(`${year}`, 2, '0');

	const from_date_str = `${year}-${month}-01`;
	const to_date_str = `${year}-${month}-${last_month_day}`;

	const history = await onCurrencyRatesHistory(
		base_currency, to_currency, 
		from_date_str, to_date_str, 
		callback
		)

	return history
}

export const onYearCurrencyRatesHistory = async (
	base_currency, to_currency, year, callback
) => {
	let history = {}
	let history_aux = {}
	
	for(let month of _.range(1, 13)) {
		history_aux = await onYearMonthCurrencyRatesHistory(
			base_currency, to_currency, month, year, 
			getCurrencyRatesHistory
		)
		
		history = {...history, ...history_aux['history']}
	}
	
	return callback(
		{
			from_currency: base_currency,
			to_currency: to_currency,
			history: history
		}
	)
}

export const getHistoryStatsCallback = (history_info) => {
	const rates = Object.values(history_info['history']);
	
	const median_val = median(rates);
	
	const min_val = Math.min(...rates);
	const max_val = Math.max(...rates);
	
	const min_key = objectKeyFind(
		history_info['history'],
		(date, rate) => rate === min_val
	)[0]

	const max_key = objectKeyFind(
		history_info['history'],
		(date, rate) => rate === max_val
	)[0]

	return {
		median: median_val,
		min_date: min_key,
		min_val: min_val,
		max_date: max_key,
		max_val: max_val,
	}
}

export const getExchangeHistoryProfit = (history) => {
	const history_currency_rates = Object.values(history['history']);
	const history_currency_dates = Object.keys(history['history']);
	
	let profit_rates = [];

	let history_currency_date = '';

	let min_profit_rate = 0;
	let max_profit_rate = 0;

	let min_profit_exchange_date = -1;
	let max_profit_exchange_date = -1;

	return objectReduce(
		history_currency_rates,
		(
			result, 
			buy_currency_id,
			buy_currency
		) => {

			buy_currency_id = Number(buy_currency_id)
			
			if(buy_currency_id !== history_currency_rates.length-1) {
				history_currency_date = history_currency_dates[buy_currency_id]
			
				profit_rates = history_currency_rates.slice(
					buy_currency_id + 1
				).map(
					(sell_currency) => getExchangeProfit(buy_currency, sell_currency)
				)
				
				min_profit_rate = Math.min(...profit_rates);
				max_profit_rate = Math.max(...profit_rates);
				
				min_profit_exchange_date = history_currency_dates[
					buy_currency_id + profit_rates.indexOf(min_profit_rate) + 1
				];

				max_profit_exchange_date = history_currency_dates[
					buy_currency_id + profit_rates.indexOf(max_profit_rate) + 1
				];
				
				result[history_currency_date] = {
					min_profit_rate: min_profit_rate,
					min_profit_exchange_date: min_profit_exchange_date,
					max_profit_rate: max_profit_rate,
					max_profit_exchange_date: max_profit_exchange_date,	
				}
			}

			return result
		}, {}
	)
}

export const getWorstBestExchangeHistoryProfit = (history) => {
	const profit_history = getExchangeHistoryProfit(history);
	const profit_history_dates = Object.keys(profit_history);

	const min_profit_rates = objectReduce(
		profit_history,
		(result, base_date, profit_info) => {
			result.push(profit_info['max_profit_rate'])
			
			return result
		}, []
	)
	
	const min_min_profit_rate = Math.min(...min_profit_rates);
	const min_min_profit_rate_id = min_profit_rates.indexOf(min_min_profit_rate);
	const min_profit_base_date = profit_history_dates[min_min_profit_rate_id];
	
	const max_profit_rates = objectReduce(
		profit_history,
		(result, base_date, profit_info) => {
			result.push(profit_info['max_profit_rate'])
			
			return result
		}, []
	)
	
	const max_max_profit_rate = Math.max(...max_profit_rates);
	const max_max_profit_rate_id = max_profit_rates.indexOf(max_max_profit_rate);
	const max_profit_base_date = profit_history_dates[max_max_profit_rate_id];
	
	return {
		'min_min_profit_base_date': min_profit_base_date,
		'min_min_profit_rate': min_min_profit_rate,
		'min_min_exchange_rate': profit_history[min_profit_base_date]['min_profit_exchange_date'],
		'max_profit_base_date': max_profit_base_date,
		'max_max_profit_date': max_max_profit_rate,
		'max_max_exchange_date': profit_history[max_profit_base_date]['max_profit_exchange_date'],
	}
}

export const getExchangeProfit = (buy_currency, sell_currency) => {
	return (sell_currency/buy_currency) - 1
}

export const logCurrenciesRatesCallback = (currency_rates_raw) => {
	console.log(currency_rates_raw.data)
}

export const saveCurrencyRatesCallback = (currency_rates_raw) => {
	
	const folder_name = `${extractHeaderDate(currency_rates_raw)}`;
	
	const file_root_path = `src/assets/${folder_name}`;

	const file_name = 'currency_rates';
	const content = JSON.stringify(currency_rates_raw.data, null, 2);
	
	try {
		fs.mkdirSync(file_root_path);
	} catch(ignore) {} finally {
		saveFileTo(file_root_path, file_name, 'json', content)
	}
}

export const getCurrencyRatesCallback = (payload) => {
	const exchange_obj = payload.data
	const base_currency = _.difference(Object.keys(exchange_obj), ['date'])[0]
	const exchange_rates = exchange_obj[base_currency]

	return {
		base_currency: base_currency,
		exchange_rates: exchange_rates
	}
}

export const buildCurrencyExchangeTable = (exchange_info) => {
	const exchange_rates = exchange_info['exchange_rates'];
	
	let exchange_table = {}
	let exchange_key = ''
	let exchange_rate = 1;
	
	const currencies = Object.keys(exchange_rates)

	// Currency exchange to itself is 1
	for(const currency of currencies) {
		exchange_key = `${currency}_${currency}`
		exchange_rate = 1
		exchange_table[exchange_key] = exchange_rate
	}
	
	// Exchange from currency 1 to 2 is C2/C1
	for(const currency_comb of _.combinations(currencies, 2)) {
		exchange_key = `${currency_comb[0]}_${currency_comb[1]}`
		exchange_rate = exchange_rates[currency_comb[1]]/exchange_rates[currency_comb[0]]
		
		exchange_table[exchange_key] = exchange_rate

		exchange_key = `${currency_comb[1]}_${currency_comb[0]}`
		exchange_rate = exchange_rates[currency_comb[0]]/exchange_rates[currency_comb[1]]
		
		exchange_table[exchange_key] = exchange_rate
	}

	return {
		currencies: currencies,
		exchange_table: exchange_table
	}
}

export const getCurrencyExchangeTableCallback = (payload) => {
	return buildCurrencyExchangeTable(
		getCurrencyRates(payload)
	)
}