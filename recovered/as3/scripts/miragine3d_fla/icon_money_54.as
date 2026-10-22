package miragine3d_fla
{
   import flash.display.MovieClip;
   import flash.events.DataEvent;
   
   [Embed(source="/_assets/assets.swf", symbol="symbol196")]
   public dynamic class icon_money_54 extends MovieClip
   {
      
      public function icon_money_54()
      {
         super();
         addFrameScript(0,this.frame1);
      }
      
      internal function frame1() : *
      {
         dispatchEvent(new DataEvent("tips",true,false,"<font color=\'#ffffff\'>金币: 这些金币是用来招兵的主要资源</font>"));
      }
   }
}

