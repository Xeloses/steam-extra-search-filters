// ==UserScript==
// @name         Steam: Extra search filters.
// @description  Add extra filters to Steam search.
// @author       Xeloses
// @version      1.0.1
// @license      GPL-3.0 (https://www.gnu.org/licenses/gpl-3.0.html)
// @namespace    Xeloses.Steam.ExtraSearchFilters
// @updateURL    https://raw.githubusercontent.com/Xeloses/steam-extra-search-filters/master/steam-extra-search-filters.user.js
// @downloadURL  https://raw.githubusercontent.com/Xeloses/steam-extra-search-filters/master/steam-extra-search-filters.user.js
// @match        https://store.steampowered.com/search*
// @grant        none
// @noframes
// @run-at       document-end
// ==/UserScript==

(function(){
    'use strict';

    /* globals $J */
    /* globals jQuery */
    /* globals rgPriceStopData */

    // @const Enable/disable status & error output to console
    const ENABLE_CONSOLE_OUTPUT = true;

    // @const Console message types
    const LOG_INFO = 1;
    const LOG_WARN = 2;
    const LOG_ERROR = 3;

    // @var filter options
    let OPTIONS = {
        // flags:
        price_filtering:false,
        with_discount:false,
        filter_f2p:false,
        filter_demo:false,
        // values:
        rating:null,
        discount:null,
        maxprice:0,
        minprice:0,
        base_maxprice:0,
        base_minprice:0,
        // steam filters:
        pass_owned:false,
        pass_ignored:false,
        pass_whishlist:false,
    };

    let FILTERED = false;

    // @var jQuery object
    let $JQ = null;

    // prevent script execution in <frame>s:
    if(window.self!=window.top) return;

    /*
     * @class Log
     */
    class XelLog{constructor(){let d=GM_info.script;this.author=d.author;this.app=d.name;this.ns=d.namespace;this.version=d.version;this.h='color:#c5c;font-weight:bold;';this.t='color:#ddd;font-weight:normal;';}log(s){console.log('%c['+this.app+']%c '+s,this.h,this.t)}info(s){console.info('%c['+this.app+']%c '+s,this.h,this.t+'font-style:italic;')}warn(s){console.warn('%c['+this.app+']%c '+s,this.h,this.t)}error(s){console.error('%c['+this.app+']%c '+s,this.h,this.t)}dump(v){console.log(v)}}
    const $log = new XelLog();

    /*
     * Extend JS Number: add method to check value is within a range.
     *
     * @param  {Integer} min
     * @param  {Integer} max
     * @return {Boolean}
     */
    Number.prototype.inRange = function(min=null,max=null)
    {
        return (!min || this >= min) && (!max || this <= max);
    };

    /*
     * Extend JS String: add method for converting string to float.
     *
     * @return {Integer|Float}
     */
    String.prototype.toFloat = function()
    {
        if(this.length)
        {
            return parseFloat(this.replace(',','.').replace(/[^\d\.]/g,''));
        }
        return 0;
    };

    /*
     * Extend JS String: add method to extract percentage value fron string.
     *
     * @return {Integer}
     */
    String.prototype.extractPercentage = function()
    {
        if(this.length)
        {
            let m = this.match(/\d{1,2}\%/);
            if(m)
            {
                return parseFloat(m[0].replace('%',''));
            }
        }
        return 0;
    };

    /*
     * Check state of filter options and determine if filtering ON or OFF.
     *
     * @return {Boolean}
     */
    function isFilterActive()
    {
        return (
            FILTERED ||
            OPTIONS.rating ||
            OPTIONS.filter_demo ||
            (
                OPTIONS.price_filtering &&
                (
                    OPTIONS.filter_f2p ||
                    OPTIONS.maxprice ||
                    OPTIONS.minprice ||
                    (
                        OPTIONS.with_discount &&
                        (
                            OPTIONS.base_maxprice ||
                            OPTIONS.base_minprice ||
                            OPTIONS.discount
                        )
                    )
                )
            )
        )
    }

    /*
     * Check game with filters and returns game state:
     *     - TRUE if games passed filters and can be shown;
     *     - FALSE is game was filtered and should be hidden;
     *     - NULL if game was processed by Steam's filters (owned/ignored/wishlist).
     *
     * @param  {jQuery.Element} game
     * @return {Boolean|NULL}
     */
    function processGame(game)
    {
        let result = true;

        // check game state and steam options:
        ['owned','ignored','wishlist'].forEach((item)=>{
            if(OPTIONS['pass_'+item] && game.hasClass('ds_'+item)) result = null;
        });

        // filter by price:
        if(result && OPTIONS.price_filtering)
        {
            let $price = game.find('div[data-price-final]'),
                price = $price.data('price-final');

            if(!price)
            {
                result = OPTIONS.filter_f2p;
            }
            else
            {
                result = (price / 100).inRange(OPTIONS.minprice,OPTIONS.maxprice);
            }
            // discounts:
            if(result && OPTIONS.with_discount)
            {
                // filter by base price:
                if(OPTIONS.base_maxprice || OPTIONS.base_minprice)
                {
                    result = $price.find('.search_price strike').text().toFloat().inRange(OPTIONS.base_minprice,OPTIONS.base_maxprice);
                }
                // filter by discount level:
                if(result && OPTIONS.discount)
                {
                    result = game.find('.search_discount').children('span').text().toFloat() >= OPTIONS.discount;
                }
            }
        }

        // filter demo:
        if(result && OPTIONS.filter_demo)
        {
            result = !/(^|.*?[\W]+?)(Prologue|Demo)([\W]+?.*?|$)/i.test(game.find('.title').text());
        }

        // filter by rating:
        if(result && OPTIONS.rating)
        {
            let rating = game.find('.search_review_summary').data('tooltip-html');
            result = (rating && rating.length && rating.extractPercentage() >= OPTIONS.rating);
        }

        return result;
    }

    /*
     * Check games list with filters and returns count of filtered games.
     *
     * @param  {jQuery.Collection} games
     * @return {Integer}
     */
    function processGames(games)
    {
        let $game = null,
            vis = null,
            count = 0;

        games.each((i,game)=>{
            $game = $JQ(game);
            vis = processGame($game);
            if(vis !== null)
            {
                if(vis == $game.is(':hidden'))
                {
                    $game.toggle();
                }
                count += (vis) ? 0 : 1;
            }
        });

        return count;
    }

    /*
     * Filter displayed games list.
     *
     * @return {void}
     */
    function filterList()
    {
        FILTERED = false;

        if(isFilterActive())
        {
            let $games = $JQ('#search_resultsRows').children('a');
            if($games && $games.length)
            {
                FILTERED = processGames($games);
            }
        }
    }

    /*
     * Filter games list from AJAX response.
     *
     * @param  {String} games_html
     * @return {void}
     */
    function filterResponse(games_html)
    {
        if(isFilterActive() && games_html.length)
        {
            // parse loaded games list, filter games and store IDs of filtered games (which should be hidden):
            let filteredGamesIDs = [];
            $JQ(games_html).filter('a.search_result_row').each(function(){
                if(processGame($JQ(this)) === false)
                {
                    filteredGamesIDs.push(this.getAttribute('data-ds-appid'));
                }
            });

            // process filtered games:
            if(filteredGamesIDs.length)
            {
                let $games_container = $JQ('#search_result_container').children('#search_resultsRows');
                // wait until loaded games will be processed by Steam:
                let timer = setInterval(()=>{
                    if($games_container.children('a[data-ds-appid="'+filteredGamesIDs[filteredGamesIDs.length-1]+'"]').length)
                    {
                        // stop timer:
                        clearInterval(timer);
                        // hide filtered games:
                        filteredGamesIDs.forEach((item)=>{
                            $games_container.children('a[data-ds-appid="'+item+'"]').hide();
                        });
                        FILTERED += filteredGamesIDs.length;
                    }
                },300);
            }
        }
    }

    /*
     * Add global AJAX request handle.
     *
     * @param  {string|regexp}  url
     * @param  {function}       fn_callback
     *
     * @callback function(string):string
     */
    function setupHook(url,fn_callback)
    {
        // add hook for global AJAX requests:
        const proxy = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function()
        {
            this.addEventListener('load',function(){
                // check filtering state:
                if(!isFilterActive()) return;
                // check response status and URL:
                if(this.readyState != XMLHttpRequest.DONE || this.status != 200) return;
                // check URL:
                if((typeof url === 'object') ? url.test(this.responseURL) : this.responseURL.includes(url))
                {
                    // check response data:
                    let data = (this.responseText && this.responseText.startsWith('{')) ? JSON.parse(this.responseText) : null;
                    if(data && data.success)
                    {
                        fn_callback(data.results_html);
                    }
                }
            });
            return proxy.apply(this,arguments);
        }
    }

    /*
     * Validate numeric value of <input type="number"> control.
     *
     * @return {void}
     */
    function validateValue()
    {
        if(isNaN(this.valueAsNumber)) return;

        if(!this.valueAsNumber.inRange(this.min,this.max))
        {
            if(this.hasAttribute('max') && this.valueAsNumber > this.max)
            {
                this.value = this.max;
            }
            else if(this.valueAsNumber < this.min)
            {
                this.value = this.min;
            }
        }
    }

    /*
     * Display value of <input type="range"> control.
     *
     * @return {void}
     */
    function updateDisplay()
    {
        $JQ('#'+this.id+'_display').text((this.value > this.min) ? ((this.value < 100) ? this.value+'% or more' : '100%') : 'Any');
    }

    /*
     * Update attributes of related <input> control.
     *
     * @return {void}
     */
    function updateControl()
    {
        if(this.value && isNaN(this.valueAsNumber))
        {
            let $this = $JQ(this);
            $this.select();
            this.value = document.getSelection().toString().toFloat();
            if(!this.value)
            {
                this.value == null;
            }
            setTimeout(()=>{$this.trigger('blur')},50);
            return;
        }

        // get OPTION name for current control:
        let name = this.id.slice(3),
            val = isNaN(this.valueAsNumber)?0:this.valueAsNumber;

        // check value was changed:
        if(OPTIONS[name] != val)
        {
            if(name.includes('min')){
                // get related control:
                let $el = $JQ('#'+this.id.replace('min','max'));
                // update related control:
                $el.attr('min',val);
                if($el.val().length && $el.val().toFloat() < val)
                {
                    $el.val(val);
                    OPTIONS[name.replace('min','max')] = val;
                }
            }
            else if(name.includes('max'))
            {
                // get related control:
                let $el = $JQ('#'+this.id.replace('max','min'));
                // update related control:
                if(val > 0)
                {
                    $el.attr('max',val);
                }
                if($el.val().length && $el.val().toFloat() > val)
                {
                    $el.val(val);
                    OPTIONS[name.replace('max','min')] = val;
                }
            }
            if(OPTIONS[name] != val)
            {
                OPTIONS[name] = val;
                filterList();
            }
        }
    }

    /*
     * Add form to page.
     *
     * @return {void}
     */
    function renderForm()
    {
        let $el = null;

        // get price filter form container:
        let $frmPriceFilter = $JQ('#additional_search_options').children('[data-collapse-name="price"]'),
            $frmPriceFilterSeparator = $frmPriceFilter.find('.block_rule');

        // get Steam's price filter control:
        let $steam_maxPrice = $frmPriceFilter.find('input#price_range'),
            steam_maxPrice = $steam_maxPrice.val() ? rgPriceStopData[$steam_maxPrice.val()].price : 0; // rgPriceStopData - array (global) from Steam's scripts

        OPTIONS.price_filtering = ($steam_maxPrice.val() > $steam_maxPrice.attr('min'));

        // get Steam's discounts checkbox element:
        let $steam_discounts = $frmPriceFilter.find('.tab_filter_control[data-param="specials"]');

        OPTIONS.with_discount = $steam_discounts.hasClass('checked');

        // create fake form for attaching new controls:
        $JQ('<form id="ex_filter_form"></form>').appendTo('body').on('submit',(e)=>{
            e.preventDefault();
            e.stopPropagation();
            return false;
        });

        // ==============
        // PRICE filters:
        // ==============

        // create base price filter form:
        let $frmBasePrice = $JQ(
            '<div class="ex-filter-block"'+(OPTIONS.with_discount?'':' style="display:none"')+'>'+
                '<div class="ex-filter-caption">Base price:</div>'+
                '<div class="ex-filter-block-half">'+
                    '<label for="ex_base_maxprice">Max:</label>'+
                    '<input id="ex_base_maxprice" type="number" name="ex_base_maxprice" min="0" step="1" form="ex_filter_form" />'+
                '</div>'+
                '<div class="ex-filter-block-half">'+
                    '<label for="ex_base_minprice">Min:</label>'+
                    '<input id="ex_base_minprice" type="number" name="ex_base_minprice" min="0" step="1" form="ex_filter_form" />'+
                '</div>'+
            '</div>'
        ).insertBefore($frmPriceFilter.find('.block_rule:first'));

        // create actual price filter form:
        let $frmActualPrice = $JQ(
            '<div class="ex-filter-block"'+(OPTIONS.price_filtering?'':' style="display:none;"')+'>'+
                '<div class="ex-filter-caption">Actual price:</div>'+
                '<div class="ex-filter-block-half">'+
                    '<label for="ex_maxprice">Max:</label>'+
                    '<input id="ex_maxprice" type="number" name="ex_maxprice"'+(steam_maxPrice?' max="'+steam_maxPrice+'"':'')+' min="0" step="1" form="ex_filter_form" />'+
                '</div>'+
                '<div class="ex-filter-block-half">'+
                    '<label for="ex_minprice">Min:</label>'+
                    '<input id="ex_minprice" type="number" name="ex_minprice" '+(steam_maxPrice?' max="'+steam_maxPrice+'"':'')+' min="0" step="1" form="ex_filter_form" />'+
                '</div>'+
            '</div>'
        ).insertBefore($frmBasePrice);

        // create "Exclude Demo & Prologue" control:
        let $ctrlFilterDemo = $JQ(
            '<div class="tab_filter_control_row" data-value="__toggle" data-clientside="1">'+
                '<span class="tab_filter_control tab_filter_control_include" id="ex_no_demo" data-value="__toggle" data-clientside="1">'+
                    '<span>'+
                        '<span class="tab_filter_control_checkbox"></span>'+
                        '<span class="tab_filter_control_label">Hide demo & prologues</span>'+
                    '</span>'+
                '</span>'+
            '</div>'
        ).insertAfter($frmBasePrice).find('#ex_no_demo').on('click',function(){
            $JQ(this).toggleClass('checked');
            OPTIONS.filter_demo = !OPTIONS.filter_demo;
            filterList();
        });

        // create "Exclude F2P" control:
        let $ctrlFilterF2P = $JQ(
            '<div class="tab_filter_control_row" data-value="__toggle" data-clientside="1">'+
                '<span class="tab_filter_control tab_filter_control_include" id="ex_no_f2p" data-value="__toggle" data-clientside="1">'+
                    '<span>'+
                        '<span class="tab_filter_control_checkbox"></span>'+
                        '<span class="tab_filter_control_label">Hide free products</span>'+
                    '</span>'+
                '</span>'+
            '</div>'
        ).insertAfter($frmBasePrice).find('#ex_no_f2p').on('click',function(){
            $JQ(this).toggleClass('checked');
            OPTIONS.filter_f2p = !OPTIONS.filter_f2p;

            if(OPTIONS.filter_f2p)
            {
                $ctrlFilterDemo.slideUp();
            }
            else
            {
                $ctrlFilterDemo.slideDown();
            }

            filterList();
        });

        // add event handlers for price controls:
        [
            $frmActualPrice.find('#ex_minprice'),
            $frmActualPrice.find('#ex_maxprice'),
            $frmBasePrice.find('#ex_base_minprice'),
            $frmBasePrice.find('#ex_base_maxprice')
        ].forEach((el)=>{
            el.on({
                change:validateValue,
                blur:updateControl,
                keypress:function(e){
                    if(e.keyCode == 13) // "Enter"
                    {
                        $JQ(this).trigger('change').trigger('blur');
                    }
                }
            });
        });

        // ================
        // DISCOUNT filter:
        // ================

        // create and insert discount filter form into page:
        let $frmDiscount = $JQ(
            '<div class="range_container"'+(OPTIONS.with_discount?'':' style="display:none"')+'>'+
	            '<div class="range_container_inner">'+
                    '<input class="range_input" type="range" id="ex_discount" name="ex_discount" min="10" max="90" step="5" value="10" form="ex_filter_form" />'+
                '</div>'+
                '<div class="range_display" id="ex_discount_display">Any</div>'+
            '</div>'
        ).insertAfter($frmPriceFilter.find('.tab_filter_control_row[data-param="specials"]'));

        // add onClick event handler to original (Steam's) discounts checkbox element:
        $steam_discounts.on('click',function(){
            OPTIONS.with_discount = !OPTIONS.with_discount;
            // base price filter:
            $frmBasePrice.slideToggle();
            // discount filter:
            $frmDiscount.slideToggle();
        });

        // add event handlers for discount filter control:
        $frmDiscount.find('#ex_discount').on({
            change:updateControl,
            input:updateDisplay
        });

        // ==============
        // RATING filter:
        // ==============

        // create and insert rating filter form into page:
        let $frmRatingFilter = $JQ(
            '<div class="block search_collapse_block" data-collapse-name="rating">'+
                '<div class="block_header">'+
                    '<div>Narrow by Rating</div>'+
                '</div>'+
                '<div class="block_content block_content_inner ex-filter-block">'+
	                '<div class="range_container">'+
                        '<div class="range_container_inner">'+
                            '<input class="range_input" type="range" id="ex_rating" name="ex_rating" min="0" max="100" step="10" value="0" form="ex_filter_form" />'+
                        '</div>'+
                        '<div class="range_display" id="ex_rating_display">Any</div>'+
                    '</div>'+
                '</div>'+
            '</div>'
        ).insertAfter($frmPriceFilter);

        // make rating filter container collapsible:
        $frmRatingFilter.find('.block_header').on('click',()=>{
            $frmRatingFilter.toggleClass('collapsed');
            $frmRatingFilter.find('.block_content_inner').toggle();
        });

        // add event handlers for rating control:
        $frmRatingFilter.find('#ex_rating').on({
            change:updateControl,
            input:updateDisplay
        });

        // ==============
        // STEAM filters:
        // ==============

        // get Steam's filter preferences and add onClick event handler:
        $el = $JQ('#additional_search_options').children('[data-collapse-name="client_filter"]');
        ['owned','ignored','wishlist'].each(function(item){
            let $elem = $el.find('.tab_filter_control[data-value="hide_'+item+'"]');
            OPTIONS['pass_'+item] = $elem.hasClass('checked')
            $elem.on('click',()=>{
                OPTIONS['pass_'+item] = !OPTIONS['pass_'+item];
            });
        });

        // add onChange event handler to original (Steam's) price range element:
        $steam_maxPrice.on('change',function(){
            OPTIONS.price_filtering = (this.value != this.min);

            if(OPTIONS.price_filtering)
            {
                if(this.value < this.max){
                    // got filtered by Steam list of games:
                    $frmActualPrice.find('#ex_maxprice').attr('max',rgPriceStopData[this.value].price).trigger('change'); // rgPriceStopData - array from Steam's scripts
                }
                else
                {
                    // got all games (no Steam's price filter):
                    $frmActualPrice.find('#ex_maxprice').removeAttr('max');
                }

                // Show price and discount filters:
                if($frmActualPrice.is(':hidden')) $frmActualPrice.slideDown();
                if(OPTIONS.with_discount && $frmBasePrice.is(':hidden')) $frmBasePrice.slideDown();

                if($ctrlFilterF2P.is(':hidden')) $ctrlFilterF2P.slideDown();

                if($steam_discounts.is(':hidden'))
                {
                    $frmPriceFilterSeparator.slideDown();
                    $steam_discounts.slideDown();
                }
            }
            else
            {
                // got only "Free to play" games => hide price and discount filters:
                $ctrlFilterF2P.slideUp();

                $frmPriceFilterSeparator.slideUp();
                if($steam_discounts.hasClass('checked')) $steam_discounts.click();
                $steam_discounts.slideUp();

                $frmActualPrice.slideUp();
            }
        }).trigger('change');
    }

    /*
     * Add custom CSS styles to page.
     *
     * @return {void}
     */
    function injectCSS()
    {
        $JQ('<style>').prop('type','text/css').html(
            '.ex-filter-block{'+
                'padding: 5px;'+
                'color: #9fbbcb;'+
                'font-size: 13px;'+
                'font-family: "Motiva Sans", Sans-serif;'+
                'white-space: nowrap;'+
                'overflow: hidden;'+
                'text-overflow: ellipsis;'+
            '}'+
            '.ex-filter-caption{'+
                'font-weight: bold;'+
            '}'+
            '.ex-filter-block label{'+
                'display: block;'+
                'padding: 0 5px;'+
                'line-height: 20px;'+
            '}'+
            '.ex-filter-block input{'+
                'width: 200px;'+
                'transition: all .2s'+
            '}'+
            '.ex-filter-block-half{'+
                'display: inline-block;'+
                'width: 49%'+
            '}'+
            '.ex-filter-block-half input{'+
                'width: 90px;'+
                'margin: 3px;'+
                'padding: 5px;'+
                'background-color: rgba(0,0,0,0.2);'+
                'color :#fff;'+
                'border:1px solid rgba(0,0,0,0.3);'+
                'border-radius: 3px;'+
                'box-shadow: 1px 1px 0px rgba(255,255,255,0.2);'+
            '}'+
            '.ex-filter-block input[type=number]:invalid{'+
                'background-color: rgba(250,150,150,.7);'+
                'border-color: #f00;'+
            '}'+
            '.range_container{'+
                'margin-top: 5px;'+
            '}'+
            '#ex_discount{'+
                'margin-top: 8px;'+
            '}'
        ).appendTo('head');
    }

    // check URL:
    if(/^https:\/\/store\.steampowered\.com\/search[\/]?\?/i.test(window.location.href))
    {

        // get jQuery:
        $JQ = (typeof $J === 'function') ? $J : ((typeof jQuery === 'function') ? jQuery : null);
        if(!$JQ)
        {
            $log('Could not get jQuery instance.',LOG_ERROR);
            return;
        }

        injectCSS();
        renderForm();
        setupHook(/https:\/\/store\.steampowered\.com\/search\/results[\/]?\?/i,filterResponse);

        $log('App loaded.');
    }
})();
