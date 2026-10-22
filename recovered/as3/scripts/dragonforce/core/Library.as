package dragonforce.core
{
   import dragonforce.utils.SWFExplorer;
   import flash.display.Loader;
   import flash.display.LoaderInfo;
   import flash.events.Event;
   import flash.events.EventDispatcher;
   import flash.events.IOErrorEvent;
   import flash.events.ProgressEvent;
   import flash.net.URLRequest;
   import flash.utils.ByteArray;
   import flash.utils.Dictionary;
   import flash.utils.getDefinitionByName;
   
   public class Library extends EventDispatcher
   {
      
      private var dict:Dictionary = new Dictionary();
      
      private var queue:int;
      
      public function Library()
      {
         super();
      }
      
      public function loadUrl(param1:String, param2:Function = null, param3:Object = null, ... rest) : void
      {
         var loader:Loader;
         var url:String = param1;
         var func:Function = param2;
         var thisObj:Object = param3;
         ++this.queue;
         loader = new Loader();
         loader.load(new URLRequest(url));
         loader.contentLoaderInfo.addEventListener(IOErrorEvent.IO_ERROR,function(param1:IOErrorEvent):void
         {
            trace(param1);
         });
         loader.contentLoaderInfo.addEventListener(ProgressEvent.PROGRESS,this.progress);
         loader.contentLoaderInfo.addEventListener(Event.COMPLETE,function(param1:Event):void
         {
            parse(LoaderInfo(param1.target));
            if(func != null)
            {
               func.apply(thisObj,rest);
            }
         });
      }
      
      public function loadBytes(param1:ByteArray, param2:Function = null, param3:Object = null, ... rest) : void
      {
         var loader:Loader;
         var bytes:ByteArray = param1;
         var func:Function = param2;
         var thisObj:Object = param3;
         ++this.queue;
         loader = new Loader();
         loader.loadBytes(bytes);
         loader.contentLoaderInfo.addEventListener(Event.COMPLETE,function(param1:Event):void
         {
            parse(LoaderInfo(param1.target));
            if(func != null)
            {
               func.apply(thisObj,rest);
            }
         });
      }
      
      private function parse(param1:LoaderInfo) : void
      {
         var _loc3_:String = null;
         var _loc2_:Array = SWFExplorer.parse(param1.bytes);
         var _loc4_:int = 0;
         while(_loc4_ < _loc2_.length)
         {
            _loc3_ = _loc2_[_loc4_];
            this.dict[_loc3_] = param1.applicationDomain.getDefinition(_loc3_);
            _loc4_++;
         }
         --this.queue;
         if(this.queue == 0)
         {
            dispatchEvent(new Event(Event.COMPLETE));
         }
      }
      
      private function progress(param1:ProgressEvent) : void
      {
         dispatchEvent(param1);
      }
      
      public function getDefinition(param1:String) : Object
      {
         return this.dict[param1];
      }
      
      public function getInstance(param1:String) : *
      {
         return new this.dict[param1]();
      }
   }
}

